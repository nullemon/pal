import { createHash } from 'node:crypto'

/**
 * docs/13 breached-password check: Have I Been Pwned range API (k-anonymity — only the
 * first five hex characters of the SHA-1 leave the server). Fails open when the network
 * is unavailable or slow, so a HIBP outage never blocks registration.
 */
export interface BreachCheck {
  breached: boolean
  /** false when the lookup could not be completed and the result is unknown. */
  checked: boolean
  count: number
}

export const HIBP_TIMEOUT_MS = 2500

export const parseHibpRange = (body: string, suffix: string): number => {
  for (const line of body.split(/\r?\n/)) {
    const [hashSuffix, count] = line.trim().split(':')
    if (hashSuffix?.toUpperCase() === suffix) return Number.parseInt(count ?? '0', 10) || 0
  }
  return 0
}

export const checkBreachedPassword = async (
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BreachCheck> => {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
  const prefix = sha1.slice(0, 5)
  const suffix = sha1.slice(5)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS)
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'PALScans' },
      signal: controller.signal,
    })
    if (!res.ok) return { breached: false, checked: false, count: 0 }
    const count = parseHibpRange(await res.text(), suffix)
    return { breached: count > 0, checked: true, count }
  } catch {
    return { breached: false, checked: false, count: 0 }
  } finally {
    clearTimeout(timer)
  }
}
