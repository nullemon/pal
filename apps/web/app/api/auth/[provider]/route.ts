import { cookies } from 'next/headers'
import { safeReturnPath } from '@/lib/auth'
import {
  beginOAuth,
  isOAuthProvider,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  providerConfigured,
  shortCookie,
} from '@/lib/auth/oauth'

/** GET /api/auth/google?return=… | /api/auth/discord — start the authorization-code + PKCE flow. */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params
  const url = new URL(request.url)
  const returnTo = safeReturnPath(url.searchParams.get('return'))
  if (!isOAuthProvider(provider)) return Response.redirect(new URL('/login', url), 302)
  if (!(await providerConfigured(provider))) {
    const target = new URL('/login', url)
    target.searchParams.set('error', 'oauth_unavailable')
    target.searchParams.set('provider', provider)
    if (returnTo !== '/') target.searchParams.set('return', returnTo)
    return Response.redirect(target, 302)
  }
  const { url: authUrl, cookie } = await beginOAuth(provider, returnTo)
  const store = await cookies()
  store.set(OAUTH_STATE_COOKIE, cookie, shortCookie(OAUTH_STATE_TTL_MS))
  return Response.redirect(authUrl, 302)
}
