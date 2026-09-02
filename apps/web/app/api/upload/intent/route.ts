import { messages } from '@palscans/core/messages'
import { chapters, getDb, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { MAX_CHAPTER_BYTES, uploadIntentSchema } from '@/components/admin/schemas'
import { audit } from '@/components/admin/server/audit'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'
import { presignUpload } from '@/lib/storage'

const ext: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

/**
 * POST /api/upload/intent — the manifest (docs/03 step 3–4): validates per-file and
 * per-chapter caps, creates or reuses the chapter rows, and answers one presigned PUT per
 * file. Keys are `uploads/<series>/<chapter>/<idx>-<sha12>.<ext>` (originals; the worker
 * writes the content-addressed variants under `pages/`).
 */
export const POST = withPermission('chapter.create', async (request, _ctx, user) => {
  const parsed = await parseJson(request, uploadIntentSchema)
  if (!parsed.ok) return parsed.response
  const { seriesId } = parsed.data
  const db = await getDb()
  const [s] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.id, seriesId), isNull(series.deletedAt)))
    .limit(1)
  if (!s) return notFound()
  const { can } = await import('@palscans/core')

  const out: Array<{
    chapterId: number
    number: number
    reused: boolean
    files: Array<{
      name: string
      key: string
      url: string
      method: 'PUT'
      headers: Record<string, string>
    }>
  }> = []
  for (const ch of parsed.data.chapters) {
    const total = ch.files.reduce((n, f) => n + f.bytes, 0)
    if (total > MAX_CHAPTER_BYTES) return fail(413, 'chapter_too_large', messages.errors.validation)
    const [existing] = await db
      .select({ id: chapters.id, state: chapters.state, pageCount: chapters.pageCount })
      .from(chapters)
      .where(
        and(
          eq(chapters.seriesId, seriesId),
          eq(chapters.number, ch.number),
          isNull(chapters.deletedAt),
        ),
      )
      .limit(1)
    let chapterId: number
    let reused = false
    if (existing) {
      // replacing pages on an existing chapter is a repair (docs/04 "Repair")
      if (existing.pageCount > 0 && !can(user, 'chapter.repair'))
        return fail(403, 'forbidden', messages.errors.forbidden)
      if (existing.state === 'processing') return fail(409, 'already_processing')
      chapterId = existing.id
      reused = true
    } else {
      const [created] = await db
        .insert(chapters)
        .values({
          seriesId,
          number: ch.number,
          title: ch.title ?? null,
          state: 'draft',
          uploadedBy: user.id,
        })
        .returning({ id: chapters.id })
      if (!created) return fail(500, 'insert_failed')
      chapterId = created.id
    }
    const files = await Promise.all(
      ch.files.map(async (f, idx) => {
        const key = `uploads/${seriesId}/${chapterId}/${String(idx).padStart(4, '0')}-${f.sha256.slice(0, 12)}.${ext[f.type]}`
        const signed = await presignUpload(key, f.type)
        return {
          name: f.name,
          key,
          url: signed.url,
          method: signed.method,
          headers: signed.headers,
        }
      }),
    )
    out.push({ chapterId, number: ch.number, reused, files })
  }
  await audit({
    actorId: user.id,
    action: 'chapter.upload_intent',
    targetType: 'series',
    targetId: seriesId,
    after: {
      chapters: out.map((c) => ({
        chapterId: c.chapterId,
        number: c.number,
        files: c.files.length,
        reused: c.reused,
      })),
    },
    request,
  })
  return ok({ chapters: out, expiresAt: new Date(Date.now() + 900_000).toISOString() })
})
