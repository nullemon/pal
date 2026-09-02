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
import { verifyTotp } from '@/lib/auth/totp'
import { findUserById } from '@/lib/auth/users'

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
  if (!user?.totpSecret || !user.totpEnabledAt || user.deletedAt)
    return fail(401, 'mfa_expired', messages.errors.unauthorized)
  if (!verifyTotp(user.totpSecret, parsed.data.code, user.email))
    return fail(401, 'totp_invalid', messages.authPage.totpInvalid)
  await clearMfaChallenge()
  const { linked } = await signIn(user.id, user.email, request, 'password', await getSessionId())
  const returnTo = challenge.returnTo
  return ok({
    return: user.username ? returnTo : `/onboarding?return=${encodeURIComponent(returnTo)}`,
    linked,
  })
}
