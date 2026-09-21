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
  /**
   * Mail is optional, and signing up is not. An operator who has not configured a provider
   * yet — which includes every operator on their first afternoon — used to find registration
   * refused outright, and the launch guide tells them to register *before* the panel where
   * mail is configured. So the account is created either way.
   *
   * With no provider there is no route to verification, so the address is marked verified on
   * creation rather than leaving the reader stranded on a screen whose only button cannot
   * work. The cost is real and belongs to the operator: unverified addresses mean nothing
   * until they set a provider up, so `require_verification` is honoured only when there is a
   * provider that could honour it.
   */
  const mailerKind = (await getMailer()).kind
  const canVerifyByEmail = mailerKind !== 'none'

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
    .values({
      email,
      passwordHash,
      username: username ?? null,
      lastLoginMethod: 'password',
      // Nothing can ever verify this address while no provider exists; an account that can
      // never leave the unverified state is worse than one that was never checked.
      emailVerifiedAt: canVerifyByEmail ? null : new Date(),
    })
    .returning({ id: users.id })
  if (!created) return fail(500, 'server_error', messages.errors.serverError)

  const sent = canVerifyByEmail ? await sendVerification(created.id, email) : { ok: false as const }
  await signIn(created.id, email, request, 'password')
  await recordLoginEvent({ request, userId: created.id, method: 'password', outcome: 'success' })
  const returnTo = safeReturnPath(parsed.data.return)
  // `require_verification` (docs/17 §C): the account exists and is signed in — so the resend
  // button works — but registration ends on the verification screen instead of the site.
  const next =
    gate.access.require_verification && canVerifyByEmail
      ? '/verify'
      : username
        ? returnTo
        : `/onboarding?return=${encodeURIComponent(returnTo)}`
  return ok({
    return: next,
    verificationSent: sent.ok,
    verificationRequired: gate.access.require_verification && canVerifyByEmail,
    breachChecked: breach.checked,
  })
}
