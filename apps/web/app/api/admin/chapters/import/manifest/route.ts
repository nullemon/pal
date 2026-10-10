import { getEnv } from '@palscans/core/env'
import {
  GalleryError,
  imgchestUrl,
  imgurAlbumUrl,
  type ManifestChapter,
  resolveManifest,
} from '@palscans/core/gallery'
import { normaliseLanguage } from '@palscans/core/languages'
import { messages } from '@palscans/core/messages'
import { can } from '@palscans/core/permissions'
import { type ChapterProcessing, chapters, getDb, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { manifestImportSchema } from '@/components/admin/schemas'
import { audit } from '@/components/admin/server/audit'
import { enqueueFetch, resolveChapterSlot } from '@/components/admin/server/chapters'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * POST /api/admin/chapters/import/manifest — a whole series from one link.
 *
 * The rows are created in a single transaction and the jobs are enqueued after it commits.
 * That order is the point: a job that starts before its chapter row is visible fails on a
 * chapter that does not exist yet, and with a hundred of them in flight the failures would
 * look like a flaky importer rather than a race.
 *
 * Enqueueing is staggered rather than fired at once. The worker runs `chapter.fetch` one at
 * a time anyway, so this is not about our own load — it is about not opening a hundred
 * near-simultaneous requests to ImgChest the moment somebody pastes a backfill, which is how
 * an importer gets an operator rate-limited within seconds of first using it.
 */

/** Seconds between queued chapters. Polite rather than slow: the worker serialises anyway. */
const STAGGER_SECONDS = 15

const sourceUrl = (chapter: ManifestChapter): string =>
  chapter.source.kind === 'direct'
    ? (chapter.source.links[0] ?? '')
    : chapter.source.provider === 'imgur'
      ? imgurAlbumUrl(chapter.source.id)
      : imgchestUrl(chapter.source.id)

export const POST = withPermission('chapter.create', async (request, _ctx, user) => {
  const parsed = await parseJson(request, manifestImportSchema)
  if (!parsed.ok) return parsed.response
  const { url, seriesId, after, onExisting } = parsed.data
  const language = normaliseLanguage(parsed.data.language)
  const store = parsed.data.store ?? 'remote'

  if (after?.mode === 'publish' && !can(user, 'chapter.publish'))
    return fail(403, 'forbidden', messages.errors.forbidden)
  if (onExisting === 'replace' && !can(user, 'chapter.repair'))
    return fail(403, 'forbidden', messages.errors.forbidden)

  const db = await getDb()
  const [s] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.id, seriesId), isNull(series.deletedAt)))
    .limit(1)
  if (!s) return notFound()

  let wanted: ManifestChapter[]
  try {
    const { manifest } = await resolveManifest(url, {
      token: getEnv().IMGCHEST_TOKEN,
      group: parsed.data.group ?? null,
    })
    /**
     * The operator's selection wins over the file.
     *
     * They have just been shown a list; importing a chapter they deselected, or one added to
     * the manifest between the preview and now, would be the panel deciding for them.
     */
    const only = parsed.data.only ? new Set(parsed.data.only) : null
    wanted = only ? manifest.chapters.filter((c) => only.has(c.number)) : manifest.chapters
  } catch (error) {
    if (error instanceof GalleryError)
      return fail(error.code === 'not_found' ? 404 : 400, error.code, error.message)
    throw error
  }
  if (wanted.length === 0) return fail(400, 'empty', 'Nothing selected to import.')

  const queued: Array<{ chapterId: number; number: number; attempt: number }> = []
  const skipped: Array<{ number: number; reason: string }> = []

  await db.transaction(async (tx) => {
    for (const chapter of wanted) {
      const slot = await resolveChapterSlot(tx, {
        seriesId,
        number: chapter.number,
        language,
        title: chapter.title,
        replace: onExisting === 'replace',
        canRepair: can(user, 'chapter.repair'),
        userId: user.id,
      })
      if (!slot.ok) {
        // A conflict is a skip, not a failure: the operator chose "skip" and ninety-nine
        // other chapters should not be abandoned because one number was taken.
        skipped.push({ number: chapter.number, reason: slot.code })
        continue
      }
      const [row] = await tx
        .select({ processing: chapters.processing })
        .from(chapters)
        .where(eq(chapters.id, slot.chapterId))
        .limit(1)
      const attempt = (row?.processing?.attempt ?? 0) + 1
      const links = chapter.source.kind === 'direct' ? chapter.source.links : undefined
      const processing: ChapterProcessing = {
        sources: [],
        progress: { done: 0, total: links?.length ?? 0 },
        errors: {},
        attempt,
        mode: 'all',
        fetch: {
          url: sourceUrl(chapter),
          provider: chapter.source.kind === 'direct' ? 'direct' : chapter.source.provider,
          title: chapter.title,
          mode: store,
          ...(links ? { links } : {}),
        },
        after: {
          isPremium: after?.isPremium ?? false,
          publishedAt: after?.mode === 'publish' ? new Date().toISOString() : null,
        },
        startedAt: null,
        finishedAt: null,
      }
      await tx
        .update(chapters)
        .set({
          state: 'processing',
          processing,
          volume: chapter.volume,
          isPremium: after?.isPremium ?? false,
          updatedAt: new Date(),
        })
        .where(eq(chapters.id, slot.chapterId))
      queued.push({ chapterId: slot.chapterId, number: chapter.number, attempt })
    }
  })

  // After the commit, never inside it: a job that beats its own row loses.
  for (const [i, job] of queued.entries())
    await enqueueFetch(job.chapterId, job.attempt, i * STAGGER_SECONDS * 1000)

  await audit({
    actorId: user.id,
    action: 'chapter.import_manifest',
    targetType: 'series',
    targetId: seriesId,
    after: {
      url,
      language,
      store,
      queued: queued.length,
      skipped: skipped.length,
      numbers: queued.slice(0, 50).map((q) => q.number),
    },
  })
  return ok({
    queued: queued.length,
    skipped,
    /** Roughly when the last chapter starts, so the panel can say more than "queued". */
    lastStartsInSeconds: Math.max(0, queued.length - 1) * STAGGER_SECONDS,
  })
})
