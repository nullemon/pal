import { messages } from '@palscans/core/messages'
import { db, ratings, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { notFound, ok, parseJson, requireUser } from '@/lib/comments/http'
import { idParamSchema, ratingSchema } from '@/lib/comments/schemas'

type Params = { id: string }

const summary = async (id: number) => {
  const [row] = await db
    .select({ ratingAvg: series.ratingAvg, ratingCount: series.ratingCount })
    .from(series)
    .where(and(eq(series.id, id), eq(series.state, 'published'), isNull(series.deletedAt)))
    .limit(1)
  return row ?? null
}

/** POST /api/series/:id/rating {score 1–10} — upsert; the series counters update by trigger. */
export const POST = requireUser<Params>(async (request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, ratingSchema)
  if (!parsed.ok) return parsed.response
  if (!(await summary(id.data))) return notFound()
  const now = new Date()
  await db
    .insert(ratings)
    .values({ userId: user.id, seriesId: id.data, score: parsed.data.score })
    .onConflictDoUpdate({
      target: [ratings.userId, ratings.seriesId],
      set: { score: parsed.data.score, updatedAt: now },
    })
  const after = await summary(id.data)
  return ok({
    score: parsed.data.score,
    ratingAvg: Number(after?.ratingAvg ?? 0),
    ratingCount: after?.ratingCount ?? 0,
    message: messages.seriesDetail.ratingSaved,
  })
})

/** DELETE /api/series/:id/rating */
export const DELETE = requireUser<Params>(async (_request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  await db.delete(ratings).where(and(eq(ratings.userId, user.id), eq(ratings.seriesId, id.data)))
  const after = await summary(id.data)
  return ok({
    score: null,
    ratingAvg: Number(after?.ratingAvg ?? 0),
    ratingCount: after?.ratingCount ?? 0,
    message: messages.seriesDetail.ratingRemoved,
  })
})
