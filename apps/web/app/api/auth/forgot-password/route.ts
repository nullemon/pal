import { messages } from '@palscans/core/messages'
import { after } from 'next/server'
import {
  accountKey,
  clientIp,
  csrfFailed,
  fail,
  getRateLimiter,
  ipKey,
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
 * or not the address exists. The answer is sent before any lookup-dependent work: the token
 * and the mail (a provider round-trip) run after the response, so neither the status nor
 * the latency says whether the address is registered.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return csrfFailed()
  const parsed = await parseJson(request, forgotSchema)
  if (!parsed.ok) return parsed.response
  const { email } = parsed.data
  const limiter = getRateLimiter()
  const ip = ipKey(clientIp(request))
  const hits = await Promise.all([
    limiter.hit(`forgot:email:${accountKey(email)}`, 3, 3600),
    ...(ip ? [limiter.hit(`forgot:ip:${ip}`, 10, 3600)] : []),
  ])
  if (hits.some((h) => !h.ok))
    return rateLimited(Math.max(...hits.map((h) => (h.ok ? 0 : h.retryAfterSec))))

  const mailer = await getMailer()
  if (mailer.kind === 'none') return fail(503, 'mail_unavailable', messages.errors.mailUnavailable)
  after(async () => {
    try {
      const user = await findUserByEmail(email)
      if (!user || user.deletedAt) return
      const token = await issueToken(user.id, 'reset_password')
      const sent = await mailer.send(resetPasswordMail(user.email, token))
      if (!sent.ok) console.error('[auth] reset mail failed', { userId: user.id })
    } catch (err) {
      console.error('[auth] forgot-password background step failed', err)
    }
  })
  return ok({ sent: true, message: messages.auth.resetSent })
}
