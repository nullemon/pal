import { getEnv } from '../env'

/**
 * docs/13 bot protection hook point: Cloudflare Turnstile on register and on login after
 * failures. Active only when TURNSTILE_SECRET_KEY is set; otherwise every check passes so
 * local development needs no Cloudflare account. The widget itself is rendered by the
 * forms when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set.
 */
export const turnstileEnabled = (): boolean => !!getEnv().TURNSTILE_SECRET_KEY

export const verifyTurnstile = async (
  token: string | undefined,
  ip: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
  const secret = getEnv().TURNSTILE_SECRET_KEY
  if (!secret) return true
  if (!token) return false
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip ?? undefined }),
    })
    const json = (await res.json()) as { success?: boolean }
    return json.success === true
  } catch {
    return false
  }
}
