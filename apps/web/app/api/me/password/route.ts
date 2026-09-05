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
import { checkBreachedPassword } from '@/lib/auth/hibp'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { changePasswordSchema } from '@/lib/auth/schemas'
import { findUserById } from '@/lib/auth/users'
import { siteCopy } from '@/lib/copy/settings'
import { getMailer, passwordChangedMail } from '@/lib/email'

/**
 * POST /api/me/password {currentPassword, password} — docs/07: requires the current
 * password, checks HIBP, rotates this session and revokes every other one.
 */
export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, changePasswordSchema)
  if (!parsed.ok) return parsed.response
  const limit = await getRateLimiter().hit(`password:${user.id}`, 5, 600)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)
  const row = await findUserById(user.id)
  if (!row?.passwordHash) return fail(400, 'no_password', messages.errors.validation)
  if (!(await verifyPassword(row.passwordHash, parsed.data.currentPassword)))
    return fail(400, 'wrong_password', messages.me.security.wrongPassword)
  const breach = await checkBreachedPassword(parsed.data.password)
  if (breach.breached) return fail(400, 'breached_password', messages.auth.breachedPassword)
  const db = await getDb()
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.password), updatedAt: new Date() })
    .where(eq(users.id, user.id))
  await revokeAllSessions(user.id)
  const created = await rotateSession(await getSessionId(), user.id, requestContext(request))
  await setSessionCookie(created)
  await (await getMailer()).send(await passwordChangedMail(row.email, await siteCopy()))
  return ok({ changed: true, message: messages.me.security.passwordChanged })
})
