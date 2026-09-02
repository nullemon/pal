import { Discord, decodeIdToken, Google, generateCodeVerifier, generateState } from 'arctic'
import { z } from 'zod'
import { getEnv } from '../env'
import { secureCookies } from './session'
import { signValue, verifyValue } from './signed'

/**
 * docs/07: authorization code + PKCE with a `state` nonce for Google and Discord. The
 * state, verifier and return path travel in one signed, short-lived cookie.
 */
export const OAUTH_PROVIDERS = ['google', 'discord'] as const
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]
export const isOAuthProvider = (v: string): v is OAuthProvider =>
  (OAUTH_PROVIDERS as readonly string[]).includes(v)

export const OAUTH_STATE_COOKIE = 'oauth_state'
export const OAUTH_LINK_COOKIE = 'oauth_link'
export const OAUTH_STATE_TTL_MS = 10 * 60_000
export const OAUTH_LINK_TTL_MS = 15 * 60_000

export const providerConfigured = (provider: OAuthProvider): boolean => {
  const env = getEnv()
  return provider === 'google'
    ? !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    : !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET)
}

export const redirectUri = (provider: OAuthProvider) =>
  `${getEnv().SITE_URL.replace(/\/+$/, '')}/api/auth/${provider}/callback`

const client = (provider: OAuthProvider) => {
  const env = getEnv()
  if (provider === 'google')
    return new Google(
      env.GOOGLE_CLIENT_ID ?? '',
      env.GOOGLE_CLIENT_SECRET ?? '',
      redirectUri('google'),
    )
  return new Discord(
    env.DISCORD_CLIENT_ID ?? '',
    env.DISCORD_CLIENT_SECRET ?? '',
    redirectUri('discord'),
  )
}

const stateSchema = z.object({
  p: z.enum(OAUTH_PROVIDERS),
  s: z.string().min(8),
  v: z.string().min(8),
  r: z.string().max(2000),
  exp: z.number().int(),
})
export type OAuthState = z.infer<typeof stateSchema>

/** Build the provider URL and the signed cookie value that must accompany it. */
export const beginOAuth = (provider: OAuthProvider, returnTo: string) => {
  const state = generateState()
  const verifier = generateCodeVerifier()
  const scopes = provider === 'google' ? ['openid', 'email', 'profile'] : ['identify', 'email']
  const url = client(provider).createAuthorizationURL(state, verifier, scopes)
  const cookie = signValue({
    p: provider,
    s: state,
    v: verifier,
    r: returnTo,
    exp: Date.now() + OAUTH_STATE_TTL_MS,
  })
  return { url, cookie }
}

export const readOAuthState = (raw: string | undefined): OAuthState | null =>
  verifyValue(raw, stateSchema)

export interface OAuthIdentity {
  provider: OAuthProvider
  uid: string
  email: string | null
  emailVerified: boolean
  name: string | null
}

const googleClaims = z.object({
  sub: z.string(),
  email: z.string().email().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
})

const discordUser = z.object({
  id: z.string(),
  username: z.string().optional(),
  global_name: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  verified: z.boolean().optional(),
})

/** Exchange the code, then fetch the identity the provider vouches for. */
export const completeOAuth = async (
  state: OAuthState,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthIdentity> => {
  const tokens = await client(state.p).validateAuthorizationCode(code, state.v)
  if (state.p === 'google') {
    const claims = googleClaims.parse(decodeIdToken(tokens.idToken()))
    return {
      provider: 'google',
      uid: claims.sub,
      email: claims.email?.toLowerCase() ?? null,
      emailVerified: claims.email_verified === true,
      name: claims.name ?? null,
    }
  }
  const res = await fetchImpl('https://discord.com/api/users/@me', {
    headers: { authorization: `Bearer ${tokens.accessToken()}` },
  })
  if (!res.ok) throw new Error(`discord profile ${res.status}`)
  const user = discordUser.parse(await res.json())
  return {
    provider: 'discord',
    uid: user.id,
    email: user.email?.toLowerCase() ?? null,
    emailVerified: user.verified === true,
    name: user.global_name ?? user.username ?? null,
  }
}

const linkSchema = z.object({
  p: z.enum(OAUTH_PROVIDERS),
  u: z.string().min(1),
  e: z.string().email(),
  r: z.string().max(2000),
  exp: z.number().int(),
})
export type PendingLink = z.infer<typeof linkSchema>

/**
 * docs/07: an OAuth identity whose email already belongs to a password account is linked
 * only after that account re-authenticates. The pending identity waits in a signed cookie;
 * the login route completes the link when the signed-in email matches.
 */
export const pendingLinkCookie = (identity: OAuthIdentity, returnTo: string): string =>
  signValue({
    p: identity.provider,
    u: identity.uid,
    e: identity.email ?? '',
    r: returnTo,
    exp: Date.now() + OAUTH_LINK_TTL_MS,
  })

export const readPendingLink = (raw: string | undefined): PendingLink | null =>
  verifyValue(raw, linkSchema)

export const shortCookie = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: secureCookies(),
  sameSite: 'lax' as const,
  path: '/',
  maxAge: Math.floor(maxAgeMs / 1000),
})
