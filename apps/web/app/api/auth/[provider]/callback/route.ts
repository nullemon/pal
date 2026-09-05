import { getDb, oauthAccounts, users } from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { getSessionId, getSessionUser } from '@/lib/auth'
import { setMfaChallenge, signIn } from '@/lib/auth/flows'
import { recordLoginEvent } from '@/lib/auth/login-events'
import {
  completeOAuth,
  isOAuthProvider,
  OAUTH_LINK_COOKIE,
  OAUTH_LINK_TTL_MS,
  OAUTH_STATE_COOKIE,
  type OAuthProvider,
  pendingLinkCookie,
  readOAuthState,
  shortCookie,
} from '@/lib/auth/oauth'
import { activeUserBan } from '@/lib/auth/users'

const loginWith = (base: URL, params: Record<string, string>) => {
  const target = new URL('/login', base)
  for (const [k, v] of Object.entries(params))
    if (v && !(k === 'return' && v === '/')) target.searchParams.set(k, v)
  return Response.redirect(target, 302)
}

const afterSignIn = (base: URL, returnTo: string, hasUsername: boolean, linked: string | null) => {
  const target = hasUsername ? new URL(returnTo, base) : new URL('/onboarding', base)
  if (!hasUsername && returnTo !== '/') target.searchParams.set('return', returnTo)
  if (linked) target.searchParams.set('linked', linked)
  return Response.redirect(target, 302)
}

/**
 * GET /api/auth/{google|discord}/callback?code&state
 * Existing identity → sign in. New identity whose email belongs to a password account →
 * park it in a signed cookie and ask for the password (docs/07: link only after re-auth).
 * Otherwise create the account and send the user to pick a username.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params
  const url = new URL(request.url)
  if (!isOAuthProvider(provider)) return loginWith(url, { error: 'oauth_failed', provider })
  const store = await cookies()
  const state = readOAuthState(store.get(OAUTH_STATE_COOKIE)?.value)
  store.set(OAUTH_STATE_COOKIE, '', { ...shortCookie(0), maxAge: 0 })
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  if (!state || state.p !== provider || !code || !stateParam || stateParam !== state.s)
    return loginWith(url, { error: 'oauth_failed', provider })
  const returnTo = state.r || '/'

  let identity: Awaited<ReturnType<typeof completeOAuth>>
  try {
    identity = await completeOAuth(state, code)
  } catch {
    return loginWith(url, { error: 'oauth_failed', provider, return: returnTo })
  }

  const db = await getDb()
  const [linkedRow] = await db
    .select({
      userId: oauthAccounts.userId,
      username: users.username,
      email: users.email,
      deletedAt: users.deletedAt,
      totpEnabledAt: users.totpEnabledAt,
      totpSecret: users.totpSecret,
    })
    .from(oauthAccounts)
    .innerJoin(users, eq(users.id, oauthAccounts.userId))
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUid, identity.uid)))
    .limit(1)
  const currentId = await getSessionId()
  if (linkedRow && !linkedRow.deletedAt) {
    if (await activeUserBan(linkedRow.userId)) {
      await recordLoginEvent({
        request,
        userId: linkedRow.userId,
        method: provider,
        outcome: 'banned',
      })
      return loginWith(url, { error: 'banned', provider, return: returnTo })
    }
    // A provider proves one factor. An account with TOTP enrolled must still present it —
    // the password route branches here, and without the same branch a linked Google or
    // Discord account was a one-factor door into the panel for staff, while
    // `adminTotpMissing()` only ever checked that a factor was *enrolled*, never used.
    if (linkedRow.totpEnabledAt && linkedRow.totpSecret) {
      // No login event here, matching the password route: the sign-in has not happened yet,
      // and the TOTP step records the outcome either way.
      await setMfaChallenge(linkedRow.userId, returnTo)
      return loginWith(url, { mfa: '1', return: returnTo })
    }
    await signIn(linkedRow.userId, linkedRow.email, request, provider, currentId)
    await recordLoginEvent({
      request,
      userId: linkedRow.userId,
      method: provider,
      outcome: 'success',
    })
    return afterSignIn(url, returnTo, !!linkedRow.username, null)
  }

  if (!identity.email || !identity.emailVerified)
    return loginWith(url, { error: 'oauth_no_email', provider, return: returnTo })

  const [existing] = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.email, identity.email))
    .limit(1)

  if (existing && !existing.deletedAt) {
    if (await activeUserBan(existing.id)) {
      await recordLoginEvent({ request, userId: existing.id, method: provider, outcome: 'banned' })
      return loginWith(url, { error: 'banned', provider, return: returnTo })
    }
    const current = await getSessionUser()
    if (current && current.id === existing.id) {
      // Initiated from the security page by the authenticated owner: link now.
      await db
        .insert(oauthAccounts)
        .values({ userId: existing.id, provider, providerUid: identity.uid })
      const target = new URL('/me/security', url)
      target.searchParams.set('linked', provider)
      return Response.redirect(target, 302)
    }
    store.set(
      OAUTH_LINK_COOKIE,
      pendingLinkCookie(identity, returnTo),
      shortCookie(OAUTH_LINK_TTL_MS),
    )
    return loginWith(url, { link: provider, email: identity.email, return: returnTo })
  }

  const [created] = await db
    .insert(users)
    .values({
      email: identity.email,
      emailVerifiedAt: new Date(),
      displayName: identity.name?.slice(0, 40) ?? null,
      lastLoginMethod: provider satisfies OAuthProvider,
    })
    .returning({ id: users.id })
  if (!created) return loginWith(url, { error: 'oauth_failed', provider, return: returnTo })
  await db.insert(oauthAccounts).values({ userId: created.id, provider, providerUid: identity.uid })
  await signIn(created.id, identity.email, request, provider, currentId)
  await recordLoginEvent({ request, userId: created.id, method: provider, outcome: 'success' })
  return afterSignIn(url, returnTo, false, null)
}
