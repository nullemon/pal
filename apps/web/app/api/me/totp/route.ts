import { messages } from '@palscans/core/messages'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import {
  fail,
  getRateLimiter,
  getSessionId,
  ok,
  parseJson,
  rateLimited,
  requireUser,
  revokeAllSessions,
  rotateSession,
  setSessionCookie,
} from '@/lib/auth'
import { requestContext } from '@/lib/auth/flows'
import { verifyPassword } from '@/lib/auth/password'
import { totpConfirmSchema, totpDisableSchema } from '@/lib/auth/schemas'
import { generateTotpSecret, totpQrDataUrl, totpUri, verifyTotp } from '@/lib/auth/totp'
import { findUserById } from '@/lib/auth/users'

/**
 * POST   /api/me/totp           start enrolment → {secret, uri, qrSvg} (pending until confirmed)
 * PATCH  /api/me/totp {code}    confirm with a code from the app → enabled
 * DELETE /api/me/totp {password} | {code}  turn off — re-authenticated with the password, or
 *        with a current code when the account has none (OAuth-only), never a bare request
 */
export const POST = requireUser(async (_request, _ctx, user) => {
  const row = await findUserById(user.id)
  if (!row) return fail(404, 'not_found', messages.errors.notFound)
  if (row.totpEnabledAt) return fail(409, 'totp_enabled', messages.me.security.totpEnabled)
  const secret = generateTotpSecret()
  const db = await getDb()
  await db
    .update(users)
    .set({ totpSecret: secret, updatedAt: new Date() })
    .where(eq(users.id, user.id))
  const uri = totpUri(secret, row.email)
  return ok({ secret, uri, qrDataUrl: await totpQrDataUrl(uri) })
})

export const PATCH = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, totpConfirmSchema)
  if (!parsed.ok) return parsed.response
  const limit = await getRateLimiter().hit(`totp:confirm:${user.id}`, 6, 300)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)
  const row = await findUserById(user.id)
  if (!row?.totpSecret) return fail(400, 'totp_not_started', messages.errors.validation)
  if (row.totpEnabledAt) return fail(409, 'totp_enabled', messages.me.security.totpEnabled)
  if (!verifyTotp(row.totpSecret, parsed.data.code, row.email))
    return fail(400, 'totp_invalid', messages.authPage.totpInvalid)
  const db = await getDb()
  await db
    .update(users)
    .set({ totpEnabledAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id))
  // privilege change: keep this device, drop the others, rotate the secret
  await revokeAllSessions(user.id)
  const created = await rotateSession(await getSessionId(), user.id, requestContext(request))
  await setSessionCookie(created)
  return ok({ enabled: true, message: messages.me.security.totpEnabled })
})

export const DELETE = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, totpDisableSchema)
  if (!parsed.ok) return parsed.response
  const limit = await getRateLimiter().hit(`totp:disable:${user.id}`, 6, 300)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)
  const row = await findUserById(user.id)
  if (!row) return fail(404, 'not_found', messages.errors.notFound)
  if (row.passwordHash) {
    const { password } = parsed.data
    if (!password || !(await verifyPassword(row.passwordHash, password)))
      return fail(400, 'wrong_password', messages.me.security.wrongPassword)
  } else {
    // password-less account: the second factor itself is the re-authentication
    const { code } = parsed.data
    if (!row.totpSecret || !code || !verifyTotp(row.totpSecret, code, row.email))
      return fail(400, 'totp_invalid', messages.authPage.totpInvalid)
  }
  const db = await getDb()
  await db
    .update(users)
    .set({ totpSecret: null, totpEnabledAt: null, updatedAt: new Date() })
    .where(eq(users.id, user.id))
  const created = await rotateSession(await getSessionId(), user.id, requestContext(request))
  await setSessionCookie(created)
  return ok({ enabled: false, message: messages.me.security.totpDisabled })
})
