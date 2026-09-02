import { messages } from '@palscans/core/messages'
import { fail, ok, parseJson, requireUser, safeReturnPath } from '@/lib/auth'
import { onboardingSchema } from '@/lib/auth/schemas'
import { changeUsername, usernameAvailability } from '@/lib/auth/users'

/** POST /api/auth/onboarding {username} — first username after an OAuth sign-up. */
export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, onboardingSchema)
  if (!parsed.ok) return parsed.response
  if (user.username) return fail(409, 'already_onboarded', messages.errors.validation)
  const availability = await usernameAvailability(parsed.data.username, user.id)
  if (availability === 'taken') return fail(409, 'username_taken', messages.auth.usernameTaken)
  if (availability === 'reserved')
    return fail(409, 'username_reserved', messages.authPage.usernameReserved)
  await changeUsername(user.id, parsed.data.username)
  return ok({ username: parsed.data.username, return: safeReturnPath(parsed.data.return) })
})
