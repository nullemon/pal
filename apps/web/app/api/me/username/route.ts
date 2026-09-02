import { messages } from '@palscans/core/messages'
import { fail, invalidateSessionCache, ok, parseJson, requireUser } from '@/lib/auth'
import { usernameChangeSchema } from '@/lib/auth/schemas'
import {
  changeUsername,
  findUserById,
  nextUsernameChangeAt,
  usernameAvailability,
} from '@/lib/auth/users'

/** POST /api/me/username {username} — docs/13: once per 30 days, old name reserved 90 days. */
export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, usernameChangeSchema)
  if (!parsed.ok) return parsed.response
  const row = await findUserById(user.id)
  if (!row) return fail(404, 'not_found', messages.errors.notFound)
  const next = nextUsernameChangeAt(row.usernameChangedAt)
  if (next) return fail(429, 'username_cooldown', messages.me.settings.usernameRule)
  if (row.username?.toLowerCase() === parsed.data.username.toLowerCase())
    return fail(400, 'username_same', messages.errors.validation)
  const availability = await usernameAvailability(parsed.data.username, user.id)
  if (availability === 'taken') return fail(409, 'username_taken', messages.auth.usernameTaken)
  if (availability === 'reserved')
    return fail(409, 'username_reserved', messages.authPage.usernameReserved)
  await changeUsername(user.id, parsed.data.username)
  await invalidateSessionCache(user.id)
  return ok({ username: parsed.data.username, message: messages.me.settings.usernameChanged })
})
