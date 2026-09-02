import { createHash } from 'node:crypto'
import { messages } from '@palscans/core/messages'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import {
  clientIp,
  csrfFailed,
  fail,
  getRateLimiter,
  getSessionId,
  ok,
  parseJson,
  rateLimited,
  safeReturnPath,
  sameOrigin,
} from '@/lib/auth'
import { setMfaChallenge, signIn } from '@/lib/auth/flows'
import { dummyHash, hashPassword, needsRehash, verifyPassword } from '@/lib/auth/password'
import { loginSchema } from '@/lib/auth/schemas'
import { verifyTurnstile } from '@/lib/auth/turnstile'
import { findUserByEmail } from '@/lib/auth/users'

const accountKey = (email: string) =>
  `login:acct:${createHash('sha256').update(email).digest('hex').slice(0, 32)}`

/**
 * POST /api/auth/login {email, password, return?}
 * docs/07: 5/min per IP and per account with exponential backoff; unknown emails answer
 * exactly like wrong passwords (a dummy Argon2 verify keeps the timing equal).
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return csrfFailed()
  const parsed = await parseJson(request, loginSchema)
  if (!parsed.ok) return parsed.response
  const { email, password } = parsed.data
  const limiter = getRateLimiter()
  const ip = clientIp(request) ?? 'unknown'
  const [byIp, byAccount] = await Promise.all([
    limiter.hitWithBackoff(`login:ip:${ip}`, 5, 60),
    limiter.hitWithBackoff(accountKey(email), 5, 60),
  ])
  if (!byIp.ok || !byAccount.ok)
    return rateLimited(Math.max(byIp.retryAfterSec, byAccount.retryAfterSec))
  if (!(await verifyTurnstile(parsed.data.turnstile, clientIp(request))))
    return fail(400, 'turnstile', messages.errors.validation)

  const user = await findUserByEmail(email)
  const hashed = user?.passwordHash ?? (await dummyHash())
  const valid = await verifyPassword(hashed, password)
  if (!user?.passwordHash || !valid || user.deletedAt)
    return fail(401, 'invalid_credentials', messages.auth.invalidCredentials)

  if (needsRehash(user.passwordHash)) {
    const db = await getDb()
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, user.id))
  }
  await Promise.all([limiter.clear(accountKey(email)), limiter.clear(`login:ip:${ip}`)])

  const returnTo = safeReturnPath(parsed.data.return)
  if (user.totpEnabledAt && user.totpSecret) {
    await setMfaChallenge(user.id, returnTo)
    return ok({ mfa: true })
  }
  const { linked } = await signIn(user.id, user.email, request, 'password', await getSessionId())
  return ok({
    mfa: false,
    return: user.username ? returnTo : `/onboarding?return=${encodeURIComponent(returnTo)}`,
    linked,
  })
}
