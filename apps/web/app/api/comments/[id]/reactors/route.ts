import { entitlement, isStaff } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { commentReactions, db, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { notFound, ok, requireUser } from '@/lib/comments/http'
import { storageUrl } from '@/lib/comments/media'
import { idParamSchema } from '@/lib/comments/schemas'

type Params = { id: string }

/** GET /api/comments/:id/reactors — Premium perk (docs/14 §1) or staff. */
export const GET = requireUser<Params>(async (_request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  if (!(entitlement(user, 'premium_content') || isStaff(user)))
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
    .where(eq(commentReactions.commentId, id.data))
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
