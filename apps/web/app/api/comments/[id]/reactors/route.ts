import { messages } from '@palscans/core/messages'
import { commentReactions, db, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { notFound, ok, requireUser } from '@/lib/comments/http'
import { storageUrl } from '@/lib/comments/media'
import { getCommentRow } from '@/lib/comments/queries'
import { idParamSchema } from '@/lib/comments/schemas'
import { entitlementGate } from '@/lib/entitlements'

type Params = { id: string }

/**
 * GET /api/comments/:id/reactors — the `see_reactors` perk (docs/14 §1). Staff bypass and
 * the operator's override both live inside `entitlement()` (docs/17 §B), so an operator can
 * make the list free for every reader — or switch it off entirely — from Admin → Premium.
 */
export const GET = requireUser<Params>(async (_request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const row = await getCommentRow(db, id.data)
  // Hidden (pending / shadow / rejected) or deleted comments answer exactly like a missing
  // id, as the report and reactions routes do — before the perk check, so the 403 / 404
  // split cannot enumerate held comments either.
  if (!row || row.deletedAt || row.status !== 'published') return notFound()
  const gate = await entitlementGate()
  if (!gate.can('see_reactors', user))
    return Response.json(
      { error: 'premium_required', message: messages.commentThread.reactorsPremium },
      { status: 403 },
    )
  const rows = await db
    .select({
      kind: commentReactions.kind,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
    })
    .from(commentReactions)
    .innerJoin(users, eq(users.id, commentReactions.userId))
    .where(eq(commentReactions.commentId, row.id))
    .limit(200)
  return ok({
    reactors: rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      username: r.username ?? `user${r.id}`,
      displayName: r.displayName ?? r.username ?? `user${r.id}`,
      avatarUrl: storageUrl(r.avatarKey),
    })),
  })
})
