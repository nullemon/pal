import { messages } from '@palscans/core/messages'
import { createReadingList, getDb, listsForUser } from '@palscans/db'
import { fail, ok, parseJson, requireUser } from '@/lib/auth'
import { createListSchema } from './_lib'

/**
 * `/api/lists` — the reader's own reading lists (docs/13 "Custom reading lists").
 * Everything here is scoped to the signed-in account; the public read path is the page at
 * `/lists/{username}/{slug}`, which needs no API.
 */

/** GET /api/lists — the account's lists with their sizes. */
export const GET = requireUser(async (_request, _ctx, user) => {
  const db = await getDb()
  return ok({ lists: await listsForUser(db, user.id) })
})

/** POST /api/lists {name, description?, isPublic?} */
export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, createListSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const created = await createReadingList(db, { userId: user.id, ...parsed.data })
  if (!created.ok) return fail(409, 'list_limit', messages.me.lists.limit)
  return ok({ list: created.list, message: messages.me.lists.created }, { status: 201 })
})
