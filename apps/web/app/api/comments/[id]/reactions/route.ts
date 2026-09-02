import { commentReactions, comments, db } from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import { notFound, ok, parseJson, requireUser } from '@/lib/comments/http'
import { getCommentRow } from '@/lib/comments/queries'
import { idParamSchema, reactionSchema } from '@/lib/comments/schemas'
import { REACTION_KINDS, type ReactionKind } from '@/lib/comments/types'

type Params = { id: string }

const counters = async (id: number, userId: number) => {
  const [row] = await db
    .select({ reactionCounts: comments.reactionCounts, score: comments.score })
    .from(comments)
    .where(eq(comments.id, id))
    .limit(1)
  const mine = await db
    .select({ kind: commentReactions.kind })
    .from(commentReactions)
    .where(and(eq(commentReactions.commentId, id), eq(commentReactions.userId, userId)))
  return {
    id,
    reactionCounts: row?.reactionCounts ?? {},
    score: row?.score ?? 0,
    viewerReactions: mine
      .map((m) => m.kind)
      .filter((k): k is ReactionKind => (REACTION_KINDS as readonly string[]).includes(k)),
  }
}

/** POST /api/comments/:id/reactions {kind} — one of each kind per user; idempotent. */
export const POST = requireUser<Params>(async (request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, reactionSchema)
  if (!parsed.ok) return parsed.response
  const row = await getCommentRow(db, id.data)
  if (!row || row.deletedAt || row.status !== 'published') return notFound()
  await db
    .insert(commentReactions)
    .values({ commentId: row.id, userId: user.id, kind: parsed.data.kind })
    .onConflictDoNothing()
  return ok(await counters(row.id, user.id))
})
