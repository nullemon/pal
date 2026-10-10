/**
 * Is this address somewhere the server may fetch from?
 *
 * The ImgChest and Imgur providers do not need this: their host allowlist is the whole
 * answer. A list of direct image URLs has no allowlist by definition — that is the point of
 * it — so it reintroduces exactly the server-side request forgery the allowlist existed to
 * prevent, and this is the replacement.
 *
 * What it is defending: an operator who pastes `http://127.0.0.1:5432/` or
 * `http://169.254.169.254/latest/meta-data/iam/` and reads the answer back out of a chapter
 * page. On this box that reaches Postgres and Valkey on loopback.
 *
 * What it does not defend: DNS rebinding. A hostname that resolves to a public address here
 * and a private one when the fetch happens defeats a check that is not pinned to the
 * resolved address. Closing that means resolving once and connecting to the literal, which
 * Node's fetch will not do without a custom agent. Given this is admin-only and gated on
 * `chapter.create`, the residual risk is an operator attacking their own server, so the
 * honest position is that it is documented rather than solved.
 */

/** Hostnames that never belong to a public image host, whatever DNS says. */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.cluster.local']
const BLOCKED_NAMES = ['localhost', 'metadata.google.internal', 'metadata', 'instance-data']

const ipv4Blocked = (parts: number[]): boolean => {
  const [a = 0, b = 0, c = 0] = parts
  if (a === 0) return true // 0.0.0.0/8 — "this host"
  if (a === 10) return true // private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, and the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true // carrier NAT
  if (a >= 224) return true // multicast and reserved, 240/4 included
  return false
}

const parseIpv4 = (value: string): number[] | null => {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const out: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    out.push(n)
  }
  return out
}

/**
 * Is this literal IP address one we refuse to connect to?
 *
 * Takes a bare address, not a URL — the caller has already parsed, and on the server side it
 * is also called with each address DNS returned for a hostname.
 */
export const isBlockedAddress = (address: string): boolean => {
  const raw = address
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
  if (raw === '') return true

  const v4 = parseIpv4(raw)
  if (v4) return ipv4Blocked(v4)

  if (!raw.includes(':')) return false // a hostname; handled by isBlockedHostname

  // IPv4-mapped and IPv4-compatible forms: ::ffff:127.0.0.1 must be judged as IPv4, or the
  // loopback check is trivially bypassed.
  const mapped = /(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(raw)
  if (mapped?.[1]) {
    const inner = parseIpv4(mapped[1])
    if (inner) return ipv4Blocked(inner)
  }

  if (raw === '::' || raw === '::0') return true // unspecified
  if (raw === '::1') return true // loopback
  const head = raw.split(':')[0] ?? ''
  if (/^f[cd][0-9a-f]{2}$/.test(head)) return true // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]$/.test(head)) return true // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}$/.test(head)) return true // ff00::/8 multicast
  if (head === '2001' && (raw.split(':')[1] ?? '') === 'db8') return true // documentation
  if (head === '64' && (raw.split(':')[1] ?? '') === 'ff9b') return true // NAT64
  return false
}

/** Is this hostname one we refuse outright, before DNS is consulted? */
export const isBlockedHostname = (hostname: string): boolean => {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (host === '') return true
  if (BLOCKED_NAMES.includes(host)) return true
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true
  // A bare name with no dot is a local or search-domain lookup, never a public image host.
  if (!host.includes('.') && !host.includes(':')) return true
  return isBlockedAddress(host)
}

/**
 * The reasons a direct image URL is refused, as a code or null when it is acceptable.
 *
 * Ports are restricted to the defaults: an image host does not serve pages on 6379, and
 * allowing an arbitrary port turns this into a port scanner that reports its findings as
 * chapter pages.
 */
export const directUrlProblem = (
  value: string,
): 'scheme' | 'port' | 'host' | 'unparseable' | null => {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return 'unparseable'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'scheme'
  // Host before port: `http://127.0.0.1:5432/` is refused either way, but "that is a private
  // address" is the finding worth reporting, and "unsupported port" would send an operator
  // looking for a port setting that does not exist.
  if (isBlockedHostname(url.hostname)) return 'host'
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return 'port'
  return null
}
