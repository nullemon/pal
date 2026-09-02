import { messages } from '@palscans/core/messages'
import { bookmarks, db, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { notFound, ok, parseJsonOptional, requireUser } from '@/lib/comments/http'
import { bookmarkSchema, idParamSchema } from '@/lib/comments/schemas'

type Params = { id: string }

const seriesCount = async (id: number) => {
  const [row] = await db
    .select({ id: series.id, bookmarkCount: series.bookmarkCount })
    .from(series)
    .where(and(eq(series.id, id), eq(series.state, 'published'), isNull(series.deletedAt)))
    .limit(1)
  return row ?? null
}

/** POST /api/series/:id/bookmark {status?} — add or change the shelf. */
export const POST = requireUser<Params>(async (request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJsonOptional(request, bookmarkSchema, { status: 'reading' })
  if (!parsed.ok) return parsed.response
  if (!(await seriesCount(id.data))) return notFound()
  await db
    .insert(bookmarks)
    .values({ userId: user.id, seriesId: id.data, status: parsed.data.status })
    .onConflictDoUpdate({
      target: [bookmarks.userId, bookmarks.seriesId],
      set: { status: parsed.data.status },
    })
  const after = await seriesCount(id.data)
  return ok({
    bookmarked: true,
    status: parsed.data.status,
    bookmarkCount: after?.bookmarkCount ?? 0,
    message: messages.seriesDetail.bookmarkAdded,
  })
})

/** DELETE /api/series/:id/bookmark */
export const DELETE = requireUser<Params>(async (_request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.userId, user.id), eq(bookmarks.seriesId, id.data)))
  const after = await seriesCount(id.data)
  return ok({
    bookmarked: false,
    status: null,
    bookmarkCount: after?.bookmarkCount ?? 0,
    message: messages.seriesDetail.bookmarkRemoved,
  })
})
