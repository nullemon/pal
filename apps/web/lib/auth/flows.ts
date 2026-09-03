import { getDb, oauthAccounts, users } from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { getMailer, verifyEmailMail } from '../email'
import { getEnv } from '../env'
import { OAUTH_LINK_COOKIE, readPendingLink, shortCookie } from './oauth'
import { clientIp } from './rate-limit'
import { rotateSession, type SessionContext, setSessionCookie } from './session'
import { signValue, verifyValue } from './signed'
import { issueToken } from './tokens'

/** Shared steps of every sign-in path (password, TOTP, OAuth, reset). */
export const requestContext = (request: Request): SessionContext => ({
  userAgent: request.headers.get('user-agent'),
  ip: clientIp(request),
})

export type LoginMethod = 'password' | 'google' | 'discord' | 'reset'

/**
 * Mint a fresh session (rotating any current one — docs/07 rotation on privilege change),
 * set the cookie, stamp last login, and complete a pending OAuth link when its email matches.
 */
export const signIn = async (
  userId: number,
  email: string,
  request: Request,
  method: LoginMethod,
  currentSessionId: string | null = null,
): Promise<{ linked: string | null }> => {
  const created = await rotateSession(currentSessionId, userId, requestContext(request))
  await setSessionCookie(created)
  const db = await getDb()
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), lastLoginMethod: method })
    .where(eq(users.id, userId))
  return { linked: await completePendingLink(userId, email) }
}

/** docs/07: link an OAuth identity to an existing password account only after re-auth. */
export const completePendingLink = async (
  userId: number,
  email: string,
): Promise<string | null> => {
  const store = await cookies()
  const pending = readPendingLink(store.get(OAUTH_LINK_COOKIE)?.value)
  if (!pending) return null
  store.set(OAUTH_LINK_COOKIE, '', { ...shortCookie(0), maxAge: 0 })
  if (pending.e.toLowerCase() !== email.toLowerCase()) return null
  const db = await getDb()
  const [existing] = await db
    .select({ id: oauthAccounts.id })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, pending.p), eq(oauthAccounts.providerUid, pending.u)))
    .limit(1)
  if (!existing) {
    await db.insert(oauthAccounts).values({ userId, provider: pending.p, providerUid: pending.u })
  }
  return pending.p
}

export const sendVerification = async (
  userId: number,
  email: string,
): Promise<{ ok: boolean; error?: string }> => {
  const token = await issueToken(userId, 'verify_email')
  return (await getMailer()).send(verifyEmailMail(email, token))
}

/** The TOTP step between a correct password and a session: a signed 5-minute cookie. */
export const MFA_COOKIE = 'mfa'
export const MFA_TTL_MS = 5 * 60_000

const mfaSchema = z.object({ u: z.number().int(), r: z.string().max(2000), exp: z.number().int() })

export const setMfaChallenge = async (userId: number, returnTo: string): Promise<void> => {
  const store = await cookies()
  store.set(
    MFA_COOKIE,
    signValue({ u: userId, r: returnTo, exp: Date.now() + MFA_TTL_MS }),
    shortCookie(MFA_TTL_MS),
  )
}

export const readMfaChallenge = async (): Promise<{ userId: number; returnTo: string } | null> => {
  const store = await cookies()
  const parsed = verifyValue(store.get(MFA_COOKIE)?.value, mfaSchema)
  return parsed ? { userId: parsed.u, returnTo: parsed.r } : null
}

export const clearMfaChallenge = async (): Promise<void> => {
  const store = await cookies()
  store.set(MFA_COOKIE, '', { ...shortCookie(0), maxAge: 0 })
}

export const siteOrigin = (): string => getEnv().SITE_URL.replace(/\/+$/, '')
