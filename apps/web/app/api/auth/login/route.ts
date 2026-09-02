import { messages } from '@palscans/core/messages'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import {
  accountKey,
  clientIp,
  csrfFailed,
  fail,
  getRateLimiter,
  getSessionId,
  ipKey,
  ok,
  parseJson,
  rateLimited,
  safeReturnPath,
  sameOrigin,
} from '@/lib/auth'
import { setMfaChallenge, signIn } from '@/lib/auth/flows'
import { recordLoginEvent } from '@/lib/auth/login-events'
import { dummyHash, hashPassword, needsRehash, verifyPassword } from '@/lib/auth/password'
import { loginSchema } from '@/lib/auth/schemas'
import { verifyTurnstile } from '@/lib/auth/turnstile'
import { activeUserBan, findUserByEmail } from '@/lib/auth/users'

/**
 * POST /api/auth/login {email, password, return?}
 * docs/07: 5/min per IP and per account with exponential backoff; unknown emails answer
 * exactly like wrong passwords (a dummy Argon2 verify keeps the timing equal). A correct
 * password never resets either window: backoff, not reset, or one owned account would
 * launder an IP's guesses against every other account.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return csrfFailed()
  const parsed = await parseJson(request, loginSchema)
  if (!parsed.ok) return parsed.response
  const { email, password } = parsed.data
  const limiter = getRateLimiter()
  // The IP bucket applies only when a trusted proxy names the client (ipKey → null otherwise).
  const ip = ipKey(clientIp(request))
  const hits = await Promise.all([
    limiter.hitWithBackoff(`login:acct:${accountKey(email)}`, 5, 60),
    ...(ip ? [limiter.hitWithBackoff(`login:ip:${ip}`, 5, 60)] : []),
  ])
  if (hits.some((h) => !h.ok)) {
    // docs/17 §C: the attempt is history too — recorded without a lookup so a flood of
    // rate-limited requests stays cheap.
    await recordLoginEvent({ request, userId: null, method: 'password', outcome: 'locked' })
    return rateLimited(Math.max(...hits.map((h) => (h.ok ? 0 : h.retryAfterSec))))
  }
  if (!(await verifyTurnstile(parsed.data.turnstile, clientIp(request))))
    return fail(400, 'turnstile', messages.errors.validation)

  const user = await findUserByEmail(email)
  const hashed = user?.passwordHash ?? (await dummyHash())
  const valid = await verifyPassword(hashed, password)
  if (!user?.passwordHash || !valid || user.deletedAt) {
    await recordLoginEvent({
      request,
      userId: user?.deletedAt ? null : (user?.id ?? null),
      method: 'password',
      outcome: 'bad_password',
    })
    return fail(401, 'invalid_credentials', messages.auth.invalidCredentials)
  }
  if (await activeUserBan(user.id)) {
    await recordLoginEvent({ request, userId: user.id, method: 'password', outcome: 'banned' })
    return fail(403, 'banned', messages.auth.banned)
  }

  if (needsRehash(user.passwordHash)) {
    const db = await getDb()
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, user.id))
  }

  const returnTo = safeReturnPath(parsed.data.return)
  if (user.totpEnabledAt && user.totpSecret) {
    await setMfaChallenge(user.id, returnTo)
    return ok({ mfa: true })
  }
  const { linked } = await signIn(user.id, user.email, request, 'password', await getSessionId())
  await recordLoginEvent({ request, userId: user.id, method: 'password', outcome: 'success' })
  return ok({
    mfa: false,
    return: user.username ? returnTo : `/onboarding?return=${encodeURIComponent(returnTo)}`,
    linked,
  })
}
