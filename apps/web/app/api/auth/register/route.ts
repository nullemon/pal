import { messages } from '@palscans/core/messages'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import {
  clientIp,
  csrfFailed,
  fail,
  getRateLimiter,
  ipKey,
  ok,
  parseJson,
  rateLimited,
  safeReturnPath,
  sameOrigin,
} from '@/lib/auth'
import { sendVerification, signIn } from '@/lib/auth/flows'
import { checkBreachedPassword } from '@/lib/auth/hibp'
import { checkRegistrationAccess, redeemInvite } from '@/lib/auth/invites'
import { recordLoginEvent } from '@/lib/auth/login-events'
import { hashPassword } from '@/lib/auth/password'
import { registerSchema } from '@/lib/auth/schemas'
import { usernameAvailability } from '@/lib/auth/users'
import { getMailer } from '@/lib/email'

/**
 * POST /api/auth/register {email, password, username?, return?}
 * docs/07: 3/hour/IP; docs/13: HIBP k-anonymity check (skipped when offline); the new
 * account is signed in at once — reading never waits for verification.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return csrfFailed()
  const ip = ipKey(clientIp(request))
  if (ip) {
    const limit = await getRateLimiter().hit(`register:ip:${ip}`, 3, 3600)
    if (!limit.ok) return rateLimited(limit.retryAfterSec)
  }

  const parsed = await parseJson(request, registerSchema)
  if (!parsed.ok) return parsed.response
  const { email, password, username } = parsed.data
  // docs/17 §C: one call covers the registration mode, the email-domain rules, Turnstile
  // (on/off in `settings.access`) and the invite code. The code is validated here and only
  // claimed once everything else has passed, so a rejected password never burns one.
  const gate = await checkRegistrationAccess({
    email,
    invite: parsed.data.invite,
    turnstileToken: parsed.data.turnstile,
    ip: clientIp(request),
  })
  if (!gate.ok) return fail(gate.status, gate.error, gate.message)
  // No provider in production: refuse before an unverifiable account exists.
  if (getMailer().kind === 'none')
    return fail(503, 'mail_unavailable', messages.errors.mailUnavailable)

  const db = await getDb()
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  if (existing) return fail(409, 'account_exists', messages.auth.accountExists)

  if (username) {
    const availability = await usernameAvailability(username)
    if (availability === 'taken') return fail(409, 'username_taken', messages.auth.usernameTaken)
    if (availability === 'reserved')
      return fail(409, 'username_reserved', messages.authPage.usernameReserved)
  }

  const breach = await checkBreachedPassword(password)
  if (breach.breached) return fail(400, 'breached_password', messages.auth.breachedPassword)

  if (gate.invite && !(await redeemInvite(gate.invite)))
    return fail(403, 'invite_invalid', messages.auth.inviteInvalid)

  const passwordHash = await hashPassword(password)
  const [created] = await db
    .insert(users)
    .values({ email, passwordHash, username: username ?? null, lastLoginMethod: 'password' })
    .returning({ id: users.id })
  if (!created) return fail(500, 'server_error', messages.errors.serverError)

  const sent = await sendVerification(created.id, email)
  await signIn(created.id, email, request, 'password')
  await recordLoginEvent({ request, userId: created.id, method: 'password', outcome: 'success' })
  const returnTo = safeReturnPath(parsed.data.return)
  // `require_verification` (docs/17 §C): the account exists and is signed in — so the resend
  // button works — but registration ends on the verification screen instead of the site.
  const next = gate.access.require_verification
    ? '/verify'
    : username
      ? returnTo
      : `/onboarding?return=${encodeURIComponent(returnTo)}`
  return ok({
    return: next,
    verificationSent: sent.ok,
    verificationRequired: gate.access.require_verification,
    breachChecked: breach.checked,
  })
}
