import { createHash } from 'node:crypto'
import { messages } from '@palscans/core/messages'
import {
  clientIp,
  csrfFailed,
  getRateLimiter,
  ok,
  parseJson,
  rateLimited,
  sameOrigin,
} from '@/lib/auth'
import { forgotSchema } from '@/lib/auth/schemas'
import { issueToken } from '@/lib/auth/tokens'
import { findUserByEmail } from '@/lib/auth/users'
import { getMailer, resetPasswordMail } from '@/lib/email'

/**
 * POST /api/auth/forgot-password {email} — docs/07: 3/hour/email, and the same 200 whether
 * or not the address exists.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return csrfFailed()
  const parsed = await parseJson(request, forgotSchema)
  if (!parsed.ok) return parsed.response
  const { email } = parsed.data
  const limiter = getRateLimiter()
  const emailKey = createHash('sha256').update(email).digest('hex').slice(0, 32)
  const [byEmail, byIp] = await Promise.all([
    limiter.hit(`forgot:email:${emailKey}`, 3, 3600),
    limiter.hit(`forgot:ip:${clientIp(request) ?? 'unknown'}`, 10, 3600),
  ])
  if (!byEmail.ok || !byIp.ok)
    return rateLimited(Math.max(byEmail.retryAfterSec, byIp.retryAfterSec))

  const user = await findUserByEmail(email)
  if (user && !user.deletedAt) {
    const token = await issueToken(user.id, 'reset_password')
    await getMailer().send(resetPasswordMail(user.email, token))
  }
  return ok({ sent: true, message: messages.auth.resetSent })
}
