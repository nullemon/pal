import { messages } from '@palscans/core/messages'
import {
  csrfFailed,
  fail,
  getRateLimiter,
  getSessionId,
  ok,
  parseJson,
  rateLimited,
  sameOrigin,
} from '@/lib/auth'
import { clearMfaChallenge, readMfaChallenge, signIn } from '@/lib/auth/flows'
import { loginTotpSchema } from '@/lib/auth/schemas'
import { consumeTotp } from '@/lib/auth/totp'
import { activeUserBan, findUserById } from '@/lib/auth/users'

/** POST /api/auth/login/totp {code} — second step after a correct password. */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return csrfFailed()
  const parsed = await parseJson(request, loginTotpSchema)
  if (!parsed.ok) return parsed.response
  const challenge = await readMfaChallenge()
  if (!challenge) return fail(401, 'mfa_expired', messages.errors.unauthorized)
  const limit = await getRateLimiter().hit(`totp:${challenge.userId}`, 6, 300)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)
  const user = await findUserById(challenge.userId)
  // Enrolment is `totpEnabledAt`, not "the secret can be read": a sealed secret that will
  // not open must fail this step, never skip it (see `totpSecretOf`).
  if (!user?.totpEnabledAt || user.deletedAt)
    return fail(401, 'mfa_expired', messages.errors.unauthorized)
  // Spends the code's step, so the same six digits cannot be presented twice inside the
  // ±1-step drift window.
  if (!(await consumeTotp(user.id, user, parsed.data.code, user.email)))
    return fail(401, 'totp_invalid', messages.authPage.totpInvalid)
  await clearMfaChallenge()
  if (await activeUserBan(user.id)) return fail(403, 'banned', messages.auth.banned)
  const { linked } = await signIn(user.id, user.email, request, 'password', await getSessionId())
  const returnTo = challenge.returnTo
  return ok({
    return: user.username ? returnTo : `/onboarding?return=${encodeURIComponent(returnTo)}`,
    linked,
  })
}
