import { messages } from '@palscans/core/messages'
import { getDb, moveListItem, removeFromReadingList } from '@palscans/db'
import { fail, ok, parseJson, type RouteParams, requireUser } from '@/lib/auth'
import { listIdSchema, moveItemSchema, ownsList, seriesIdSchema } from '../../../_lib'

type Params = { id: string; seriesId: string }

/** The list and series this request names, or null when either is unusable or not the user's. */
const target = async (ctx: RouteParams<Params>, userId: number) => {
  const raw = await ctx.params
  const id = listIdSchema.safeParse(raw.id)
  const seriesId = seriesIdSchema.safeParse(raw.seriesId)
  if (!id.success || !seriesId.success) return null
  if (!(await ownsList(id.data, userId))) return null
  return { listId: id.data, seriesId: seriesId.data }
}

/** PATCH /api/lists/:id/items/:seriesId {toIndex} — move one entry, 0-based. */
export const PATCH = requireUser<Params>(async (request, ctx, user) => {
  const parsed = await parseJson(request, moveItemSchema)
  if (!parsed.ok) return parsed.response
  const where = await target(ctx, user.id)
  if (!where) return fail(404, 'not_found', messages.errors.notFound)
  const db = await getDb()
  const order = await moveListItem(db, { ...where, toIndex: parsed.data.toIndex })
  if (!order) return fail(404, 'not_found', messages.errors.notFound)
  return ok({ order, message: messages.me.lists.moved })
})

/** DELETE /api/lists/:id/items/:seriesId */
export const DELETE = requireUser<Params>(async (_request, ctx, user) => {
  const where = await target(ctx, user.id)
  if (!where) return fail(404, 'not_found', messages.errors.notFound)
  const db = await getDb()
  const removed = await removeFromReadingList(db, where)
  if (!removed) return fail(404, 'not_found', messages.errors.notFound)
  return ok({ removed: true, message: messages.me.lists.removed })
})
