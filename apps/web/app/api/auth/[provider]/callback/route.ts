import { getDb, oauthAccounts, users } from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { getSessionId, getSessionUser } from '@/lib/auth'
import { signIn } from '@/lib/auth/flows'
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
    })
    .from(oauthAccounts)
    .innerJoin(users, eq(users.id, oauthAccounts.userId))
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUid, identity.uid)))
    .limit(1)
  const currentId = await getSessionId()
  if (linkedRow && !linkedRow.deletedAt) {
    await signIn(linkedRow.userId, linkedRow.email, request, provider, currentId)
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
  return afterSignIn(url, returnTo, false, null)
}
