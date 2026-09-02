import { messages } from '@palscans/core/messages'
import { fail, getRateLimiter, ok, rateLimited, requireUser } from '@/lib/auth'
import { sendVerification } from '@/lib/auth/flows'

/** POST /api/auth/resend-verification — signed in, unverified, 3/hour. */
export const POST = requireUser(async (_request, _ctx, user) => {
  if (user.emailVerifiedAt) return ok({ sent: false, alreadyVerified: true })
  const limit = await getRateLimiter().hit(`verify:resend:${user.id}`, 3, 3600)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)
  if (user.email) {
    const sent = await sendVerification(user.id, user.email)
    if (!sent.ok) return fail(503, 'mail_unavailable', messages.errors.mailUnavailable)
  }
  return ok({ sent: true, message: messages.authPage.verifyResent })
})
