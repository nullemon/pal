import { messages } from '@palscans/core/messages'
import { chapters, getDb } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { uploadCommitSchema } from '@/components/admin/schemas'
import { audit } from '@/components/admin/server/audit'
import { emptyProcessing, enqueueProcess } from '@/components/admin/server/chapters'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'
import { getStorage } from '@/lib/storage'

/**
 * POST /api/upload/commit — docs/03 step 6–7: the ordered key list becomes the chapter's
 * processing document, the state flips to `processing`, and `chapter.process` is enqueued.
 */
export const POST = withPermission('chapter.create', async (request, _ctx, user) => {
  const parsed = await parseJson(request, uploadCommitSchema)
  if (!parsed.ok) return parsed.response
  const { chapterId, keys, after } = parsed.data
  const db = await getDb()
  const [row] = await db
    .select({
      id: chapters.id,
      seriesId: chapters.seriesId,
      state: chapters.state,
      processing: chapters.processing,
    })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), isNull(chapters.deletedAt)))
    .limit(1)
  if (!row) return notFound()
  if (row.state === 'processing') return fail(409, 'already_processing')
  const prefix = `uploads/${row.seriesId}/${chapterId}/`
  if (!keys.every((k) => k.startsWith(prefix)))
    return fail(400, 'validation', messages.errors.validation)
  const storage = await getStorage()
  const missing: string[] = []
  for (const k of keys) if (!(await storage.exists(k))) missing.push(k)
  if (missing.length) return fail(400, 'missing_objects', missing.slice(0, 5).join(', '))
  if (after && (after.mode === 'publish' || after.mode === 'schedule')) {
    const { can } = await import('@palscans/core')
    if (!can(user, 'chapter.publish')) return fail(403, 'forbidden', messages.errors.forbidden)
  }
  const sources = keys.map((key, idx) => ({
    idx,
    key,
    bytes: 0,
    sha256: key.slice(-16).split('.')[0] ?? '',
  }))
  const processing = {
    ...emptyProcessing(sources),
    attempt: (row.processing?.attempt ?? 0) + 1,
    after: {
      isPremium: after?.isPremium ?? false,
      publishedAt:
        after?.mode === 'publish'
          ? new Date().toISOString()
          : after?.mode === 'schedule'
            ? (after.publishedAt ?? null)
            : null,
    },
  }
  await db
    .update(chapters)
    .set({
      state: 'processing',
      processing,
      isPremium: after?.isPremium ?? false,
      updatedAt: new Date(),
    })
    .where(eq(chapters.id, chapterId))
  const jobId = await enqueueProcess(chapterId, processing.attempt)
  await audit({
    actorId: user.id,
    action: 'chapter.commit',
    targetType: 'chapter',
    targetId: chapterId,
    after: { pages: keys.length, jobId, after: processing.after },
    request,
  })
  return ok({ chapterId, jobId, pages: keys.length })
})
