import { messages } from '@palscans/core/messages'
import { addToReadingList, getDb } from '@palscans/db'
import { fail, ok, parseJson, requireUser } from '@/lib/auth'
import { addItemSchema, listIdSchema, ownsList } from '../../_lib'

type Params = { id: string }

/** POST /api/lists/:id/items {seriesId} — append a series to the end of the list. */
export const POST = requireUser<Params>(async (request, ctx, user) => {
  const id = listIdSchema.safeParse((await ctx.params).id)
  if (!id.success) return fail(404, 'not_found', messages.errors.notFound)
  const parsed = await parseJson(request, addItemSchema)
  if (!parsed.ok) return parsed.response
  if (!(await ownsList(id.data, user.id))) return fail(404, 'not_found', messages.errors.notFound)
  const db = await getDb()
  const added = await addToReadingList(db, { listId: id.data, seriesId: parsed.data.seriesId })
  if (!added.ok) {
    if (added.reason === 'duplicate') return fail(409, 'duplicate', messages.me.lists.duplicate)
    if (added.reason === 'full') return fail(409, 'list_full', messages.me.lists.full)
    return fail(404, 'not_found', messages.errors.notFound)
  }
  return ok({ position: added.position, message: messages.me.lists.added }, { status: 201 })
})
