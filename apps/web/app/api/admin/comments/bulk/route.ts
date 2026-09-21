import { comments, getDb } from '@palscans/db'
import { inArray } from 'drizzle-orm'
import { commentBulkSchema } from '@/components/admin/schemas-moderation'
import { audit } from '@/components/admin/server/audit'
import { resolveReportsFor } from '@/components/admin/server/moderation'
import { ok, parseJson, withPermission } from '@/lib/auth'

/** POST /api/admin/comments/bulk { ids, action } — approve / reject / delete many. */
export const POST = withPermission('comment.moderate', async (request, _ctx, user) => {
  const parsed = await parseJson(request, commentBulkSchema)
  if (!parsed.ok) return parsed.response
  const { ids, action } = parsed.data
  const db = await getDb()
  const now = new Date()
  if (action === 'approve')
    await db.update(comments).set({ status: 'published' }).where(inArray(comments.id, ids))
  if (action === 'reject')
    await db.update(comments).set({ status: 'rejected' }).where(inArray(comments.id, ids))
  if (action === 'delete')
    await db
      .update(comments)
      .set({ status: 'removed', deletedAt: now })
      .where(inArray(comments.id, ids))
  await resolveReportsFor('comment', ids, user.id, action === 'approve' ? 'rejected' : 'actioned')
  await audit({
    actorId: user.id,
    action: `comment.bulk.${action}`,
    targetType: 'comment',
    targetId: ids[0] ?? null,
    after: { ids },
  })
  return ok({ ids })
})
