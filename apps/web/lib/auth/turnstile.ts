import { credentialUnreadable } from '@/lib/config/store'
import { resolveConfig } from '../config/store'

/**
 * docs/13 bot protection hook point: Cloudflare Turnstile on register and on login after
 * failures. Active only when a secret key is set; otherwise every check passes so local
 * development needs no Cloudflare account.
 *
 * Both keys come from the admin panel first and the environment second (docs/19). The site
 * key is public — it is rendered into the page — but it is read here on the **server** and
 * passed down as a prop, never inlined into the client bundle at build time: that is what
 * lets an operator paste a pair into Admin → System → Integrations and have the widget
 * appear on the next request instead of the next deploy.
 */

export interface TurnstileKeys {
  siteKey: string
  secretKey: string
}

export const turnstileKeys = async (): Promise<TurnstileKeys> => {
  const { values } = await resolveConfig()
  return {
    siteKey: values['bot.turnstile_site_key'] ?? '',
    secretKey: values['bot.turnstile_secret_key'] ?? '',
  }
}

/** Whether the server will verify tokens — the switch that decides if a check is enforced. */
export const turnstileEnabled = async (): Promise<boolean> => !!(await turnstileKeys()).secretKey

/** The site key to render, or null when there is nothing to render. */
export const turnstileSiteKey = async (): Promise<string | null> =>
  (await turnstileKeys()).siteKey || null

/**
 * Both halves present: the challenge can be *shown* and *verified*. Admin → System → Access
 * reports this, and keeps its switch disabled until it is true, rather than pretending the
 * site is protected.
 */
export const turnstileConfigured = async (): Promise<boolean> => {
  const { siteKey, secretKey } = await turnstileKeys()
  return !!siteKey && !!secretKey
}

/**
 * `remoteip` is deliberately not sent. Cloudflare's siteverify accepts the visitor's address
 * as an optional extra signal; it is optional, the edge already sees the address anyway when
 * the site is behind Cloudflare, and this site does not hand a visitor's address to anything
 * it does not have to.
 */
export const verifyTurnstile = async (
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
  const { secretKey: secret } = await turnstileKeys()
  if (!secret) {
    // "No secret" normally means the operator has not enabled bot protection, and every
    // request passes. But a stored secret that will not decrypt — a rotated sealing key —
    // reads as absent too, and silently turning a security control off is the worst possible
    // reading of that. When a row is present but unreadable, fail closed instead.
    if (await credentialUnreadable('bot.turnstile_secret_key')) return false
    return true
  }
  if (!token) return false
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
    })
    const json = (await res.json()) as { success?: boolean }
    return json.success === true
  } catch {
    return false
  }
}
