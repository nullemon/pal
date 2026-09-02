import { fmt, messages } from '@palscans/core/messages'
import { bookmarks, getDb } from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { fail, ok, parseJson, requireUser } from '@/lib/auth'
import { BOOKMARK_STATUSES } from '@/lib/auth/schemas'

type Params = { seriesId: string }
const idSchema = z.coerce.number().int().positive()
const patchSchema = z.object({ status: z.enum(BOOKMARK_STATUSES) })

/** PATCH /api/me/bookmarks/:seriesId {status} — move a bookmark between the five shelves. */
export const PATCH = requireUser<Params>(async (request, ctx, user) => {
  const id = idSchema.safeParse((await ctx.params).seriesId)
  if (!id.success) return fail(404, 'not_found', messages.errors.notFound)
  const parsed = await parseJson(request, patchSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const rows = await db
    .update(bookmarks)
    .set({ status: parsed.data.status })
    .where(and(eq(bookmarks.userId, user.id), eq(bookmarks.seriesId, id.data)))
    .returning({ seriesId: bookmarks.seriesId })
  if (rows.length === 0) return fail(404, 'not_found', messages.errors.notFound)
  return ok({
    status: parsed.data.status,
    message: fmt(messages.me.bookmarks.statusSaved, {
      status: messages.series.bookmarkStatus[parsed.data.status],
    }),
  })
})

/** DELETE /api/me/bookmarks/:seriesId */
export const DELETE = requireUser<Params>(async (_request, ctx, user) => {
  const id = idSchema.safeParse((await ctx.params).seriesId)
  if (!id.success) return fail(404, 'not_found', messages.errors.notFound)
  const db = await getDb()
  await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.userId, user.id), eq(bookmarks.seriesId, id.data)))
  return ok({ removed: true, message: messages.me.bookmarks.removed })
})
