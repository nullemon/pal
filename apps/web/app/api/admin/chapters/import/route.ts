import { getEnv } from '@palscans/core/env'
import {
  GalleryError,
  identifyGallery,
  imgchestUrl,
  imgurAlbumUrl,
  resolveGallery,
} from '@palscans/core/gallery'
import { normaliseLanguage } from '@palscans/core/languages'
import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { can } from '@palscans/core/permissions'
import { type ChapterProcessing, chapters, getDb, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { galleryImportSchema } from '@/components/admin/schemas'
import { audit } from '@/components/admin/server/audit'
import { enqueueFetch, resolveChapterSlot } from '@/components/admin/server/chapters'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * POST /api/admin/chapters/import — create a chapter from a gallery link.
 *
 * The web app's whole job here is to write down the intent and get out of the way: resolve
 * the chapter row under the same conflict rules as a browser upload, record the link in
 * `processing.fetch`, and enqueue `chapter.fetch`. It does not download anything. Forty
 * pages is eighty megabytes, and a request handler on a 2 GB box behind a proxy timeout is
 * the wrong place for it — the worker already has retries, progress and a graceful shutdown.
 *
 * The gallery *is* resolved once, before the row is created, so an unreachable or bogus link
 * is a 400 the operator sees rather than a draft chapter that fails later. That costs one
 * cheap request and is the difference between an error message and a cleanup job.
 */
/** The canonical gallery URL for a provider and id. Never what was pasted. */
const canonicalGalleryUrl = (g: { provider: 'imgchest' | 'imgur'; id: string }): string =>
  g.provider === 'imgur' ? imgurAlbumUrl(g.id) : imgchestUrl(g.id)

export const POST = withPermission('chapter.create', async (request, _ctx, user) => {
  const parsed = await parseJson(request, galleryImportSchema)
  if (!parsed.ok) return parsed.response
  const { url, after } = parsed.data
  // Rejected before any network call: the host allowlist lives in the parser, and a link on
  // another host must never reach `resolveGallery`.
  const gallery = identifyGallery(url)
  if (!gallery) return fail(400, 'bad_url', adminMessages.admin.galleryImport.badUrl)

  if (after && (after.mode === 'publish' || after.mode === 'schedule')) {
    if (!can(user, 'chapter.publish')) return fail(403, 'forbidden', messages.errors.forbidden)
  }

  const db = await getDb()

  /**
   * Resolve the target before touching the network.
   *
   * `chapterId` is the page editor's route in: the chapter exists, so there is nothing to
   * create and nothing to decide about numbering — only whether this person may throw its
   * current pages away. That is `chapter.repair`, checked here rather than left to the
   * permission wrapper, which only guards `chapter.create`.
   */
  let target: { chapterId: number; seriesId: number; language: string; replaced: boolean } | null =
    null
  if (parsed.data.chapterId !== undefined) {
    if (!can(user, 'chapter.repair')) return fail(403, 'forbidden', messages.errors.forbidden)
    const [row] = await db
      .select({
        id: chapters.id,
        seriesId: chapters.seriesId,
        state: chapters.state,
        language: chapters.language,
        pageCount: chapters.pageCount,
      })
      .from(chapters)
      .where(and(eq(chapters.id, parsed.data.chapterId), isNull(chapters.deletedAt)))
      .limit(1)
    if (!row) return notFound()
    if (row.state === 'processing') return fail(409, 'already_processing')
    target = {
      chapterId: row.id,
      seriesId: row.seriesId,
      language: row.language,
      replaced: row.pageCount > 0,
    }
  }

  const seriesId = target?.seriesId ?? (parsed.data.seriesId as number)
  const language = target?.language ?? normaliseLanguage(parsed.data.language)
  const [s] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.id, seriesId), isNull(series.deletedAt)))
    .limit(1)
  if (!s) return notFound()

  let pages: number
  let galleryTitle: string | null
  try {
    const post = await resolveGallery(url, { token: getEnv().IMGCHEST_TOKEN })
    pages = post.images.length
    galleryTitle = post.title
  } catch (error) {
    if (error instanceof GalleryError)
      return fail(error.code === 'not_found' ? 404 : 400, error.code, error.message)
    throw error
  }

  const slot =
    target ??
    (await resolveChapterSlot(db, {
      seriesId,
      number: parsed.data.number as number,
      language,
      title: parsed.data.title ?? null,
      replace: parsed.data.replace,
      canRepair: can(user, 'chapter.repair'),
      userId: user.id,
    }))
  if ('ok' in slot && !slot.ok) {
    if (slot.code === 'chapter_exists')
      return fail(
        409,
        'chapter_exists',
        fmt(adminMessages.bulkImport.conflict.title, {
          n: String(parsed.data.number),
          pages: slot.pages,
        }),
      )
    if (slot.code === 'forbidden') return fail(403, 'forbidden', messages.errors.forbidden)
    if (slot.code === 'already_processing') return fail(409, 'already_processing')
    return fail(500, 'insert_failed')
  }

  const [row] = await db
    .select({ processing: chapters.processing })
    .from(chapters)
    .where(eq(chapters.id, slot.chapterId))
    .limit(1)
  const attempt = (row?.processing?.attempt ?? 0) + 1
  /**
   * No sources yet, and `fetch` set: the state that says "the download has not run".
   *
   * `progress.total` is seeded from the resolved gallery so the panel shows 0 / 23 instead of
   * 0 / 0 for however long the first download takes.
   */
  const processing: ChapterProcessing = {
    sources: [],
    progress: { done: 0, total: pages },
    errors: {},
    attempt,
    mode: 'all',
    // Rebuilt from the parsed id rather than stored as pasted, so the worker never follows
    // a URL carrying tracking parameters or an unexpected path.
    fetch: {
      url: canonicalGalleryUrl(gallery),
      provider: gallery.provider,
      title: galleryTitle,
      mode: parsed.data.store ?? 'remote',
    },
    after: {
      isPremium: after?.isPremium ?? false,
      publishedAt:
        after?.mode === 'publish'
          ? new Date().toISOString()
          : after?.mode === 'schedule'
            ? (after.publishedAt ?? null)
            : null,
    },
    startedAt: null,
    finishedAt: null,
  }
  await db
    .update(chapters)
    .set({
      state: 'processing',
      processing,
      isPremium: after?.isPremium ?? false,
      updatedAt: new Date(),
    })
    .where(eq(chapters.id, slot.chapterId))

  const jobId = await enqueueFetch(slot.chapterId, attempt)
  await audit({
    actorId: user.id,
    action: 'chapter.import_gallery',
    targetType: 'chapter',
    targetId: slot.chapterId,
    after: {
      provider: 'imgchest',
      galleryId: gallery.id,
      pages,
      number: parsed.data.number ?? null,
      language,
      replaced: slot.replaced,
      store: parsed.data.store ?? 'remote',
      jobId,
    },
  })
  return ok({
    chapterId: slot.chapterId,
    jobId,
    pages,
    replaced: slot.replaced,
    galleryTitle,
  })
})
