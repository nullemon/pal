import { messages } from '@palscans/core/messages'
import { db, userBlocks, users } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { fail, notFound, ok, requireUser } from '@/lib/comments/http'
import { idParamSchema } from '@/lib/comments/schemas'

type Params = { id: string }

/** POST /api/comments/users/:id/block — hide that user everywhere for the viewer (docs/14 §1). */
export const POST = requireUser<Params>(async (_request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  if (id.data === user.id) return fail(400, 'validation', messages.errors.validation)
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id.data), isNull(users.deletedAt)))
    .limit(1)
  if (!target) return notFound()
  await db
    .insert(userBlocks)
    .values({ blockerId: user.id, blockedId: id.data })
    .onConflictDoNothing()
  return ok({ blocked: id.data, message: messages.commentThread.blocked })
})

/** DELETE /api/comments/users/:id/block */
export const DELETE = requireUser<Params>(async (_request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  await db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, user.id), eq(userBlocks.blockedId, id.data)))
  return ok({ unblocked: id.data, message: messages.commentThread.unblocked })
})
