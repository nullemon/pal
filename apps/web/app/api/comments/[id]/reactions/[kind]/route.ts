import { commentReactions, comments, db } from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { notFound, ok, requireUser } from '@/lib/comments/http'
import { idParamSchema } from '@/lib/comments/schemas'
import { REACTION_KINDS, type ReactionKind } from '@/lib/comments/types'

type Params = { id: string; kind: string }

/** DELETE /api/comments/:id/reactions/:kind — remove the viewer's reaction of that kind. */
export const DELETE = requireUser<Params>(async (_request, ctx, user) => {
  const params = await ctx.params
  const id = idParamSchema.safeParse(params.id)
  const kind = z.enum(REACTION_KINDS).safeParse(params.kind)
  if (!id.success || !kind.success) return notFound()
  await db
    .delete(commentReactions)
    .where(
      and(
        eq(commentReactions.commentId, id.data),
        eq(commentReactions.userId, user.id),
        eq(commentReactions.kind, kind.data),
      ),
    )
  const [row] = await db
    .select({ reactionCounts: comments.reactionCounts, score: comments.score })
    .from(comments)
    .where(eq(comments.id, id.data))
    .limit(1)
  if (!row) return notFound()
  const mine = await db
    .select({ kind: commentReactions.kind })
    .from(commentReactions)
    .where(and(eq(commentReactions.commentId, id.data), eq(commentReactions.userId, user.id)))
  return ok({
    id: id.data,
    reactionCounts: row.reactionCounts,
    score: row.score,
    viewerReactions: mine
      .map((m) => m.kind)
      .filter((k): k is ReactionKind => (REACTION_KINDS as readonly string[]).includes(k)),
  })
})
