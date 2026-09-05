import { messages } from '@palscans/core/messages'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { csrfFailed, fail, ok, parseJson, revokeAllSessions, sameOrigin } from '@/lib/auth'
import { checkBreachedPassword } from '@/lib/auth/hibp'
import { hashPassword } from '@/lib/auth/password'
import { resetSchema } from '@/lib/auth/schemas'
import { consumeToken, peekToken } from '@/lib/auth/tokens'
import { findUserById } from '@/lib/auth/users'
import { siteCopy } from '@/lib/copy/settings'
import { getMailer, passwordChangedMail } from '@/lib/email'

/**
 * POST /api/auth/reset-password {token, password} — single-use token; every session is
 * revoked (docs/07 rotation on privilege change), the user signs in with the new password.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return csrfFailed()
  const parsed = await parseJson(request, resetSchema)
  if (!parsed.ok) return parsed.response
  const { token, password } = parsed.data
  if (!(await peekToken(token, 'reset_password')))
    return fail(400, 'token_invalid', messages.authPage.resetInvalid)
  const breach = await checkBreachedPassword(password)
  if (breach.breached) return fail(400, 'breached_password', messages.auth.breachedPassword)
  const consumed = await consumeToken(token, 'reset_password')
  if (!consumed) return fail(400, 'token_invalid', messages.authPage.resetInvalid)
  const user = await findUserById(consumed.userId)
  if (!user || user.deletedAt) return fail(400, 'token_invalid', messages.authPage.resetInvalid)
  const db = await getDb()
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      updatedAt: new Date(),
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    })
    .where(eq(users.id, user.id))
  await revokeAllSessions(user.id)
  await (await getMailer()).send(passwordChangedMail(user.email, await siteCopy()))
  return ok({ reset: true, message: messages.authPage.resetDone })
}
