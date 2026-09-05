import { messages } from '@palscans/core/messages'
import { deleteReadingList, getDb, updateReadingList } from '@palscans/db'
import { fail, ok, parseJson, requireUser } from '@/lib/auth'
import { listIdSchema, patchListSchema } from '../_lib'

type Params = { id: string }

/** PATCH /api/lists/:id {name?, description?, isPublic?} — rename, re-describe, publish. */
export const PATCH = requireUser<Params>(async (request, ctx, user) => {
  const id = listIdSchema.safeParse((await ctx.params).id)
  if (!id.success) return fail(404, 'not_found', messages.errors.notFound)
  const parsed = await parseJson(request, patchListSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const list = await updateReadingList(db, { id: id.data, userId: user.id, ...parsed.data })
  if (!list) return fail(404, 'not_found', messages.errors.notFound)
  const message =
    parsed.data.isPublic === undefined
      ? messages.me.lists.renamed
      : parsed.data.isPublic
        ? messages.me.lists.madePublic
        : messages.me.lists.madePrivate
  return ok({ list, message })
})

/** DELETE /api/lists/:id — the list and its membership rows; bookmarks are untouched. */
export const DELETE = requireUser<Params>(async (_request, ctx, user) => {
  const id = listIdSchema.safeParse((await ctx.params).id)
  if (!id.success) return fail(404, 'not_found', messages.errors.notFound)
  const db = await getDb()
  const removed = await deleteReadingList(db, { id: id.data, userId: user.id })
  if (!removed) return fail(404, 'not_found', messages.errors.notFound)
  return ok({ removed: true, message: messages.me.lists.deleted })
})
