import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Where a connection test is allowed to connect.
 *
 * The tests take an operator-supplied host (an SMTP server, an S3 endpoint) and make the
 * server connect to it, which is an SSRF primitive: only an authenticated admin with TOTP can
 * reach it, but that is a thin margin to leave in front of the cloud metadata endpoint, and
 * the SMTP test reflects up to a couple of hundred characters of whatever answers.
 *
 * So the host is resolved first and internal targets are refused. Loopback stays allowed for
 * SMTP only, because `infra/docker-compose.yml` ships Mailpit on localhost and testing it is
 * a legitimate thing to do; nothing else has a reason to point inward.
 */

const bytesOf = (ip: string): number[] => ip.split('.').map(Number)

/** RFC1918, link-local (incl. cloud metadata at 169.254.169.254), CGNAT and friends. */
const isPrivateV4 = (ip: string): boolean => {
  const [a = 0, b = 0] = bytesOf(ip)
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a >= 224) return true
  return false
}

const isPrivateV6 = (ip: string): boolean => {
  const v = ip.toLowerCase().split('%')[0] ?? ''
  if (v === '::1' || v === '::') return true
  if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true
  if (v.startsWith('ff')) return true
  // ::ffff:10.0.0.1 and friends
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
  return mapped?.[1] ? isPrivateV4(mapped[1]) : false
}

export const isLoopback = (ip: string): boolean =>
  ip === '::1' || (isIP(ip) === 4 && bytesOf(ip)[0] === 127)

export interface HostVerdict {
  allowed: boolean
  /** Set when refused, for the operator's report. */
  reason?: string
  addresses: string[]
}

/**
 * Resolve `host` and decide whether the test may connect to it.
 *
 * Every resolved address is checked, not just the first: a name that returns one public and
 * one internal address must not slip through.
 */
export const checkHost = async (
  host: string,
  opts: { allowLoopback?: boolean } = {},
): Promise<HostVerdict> => {
  const name = host.trim()
  if (!name) return { allowed: false, reason: 'No host given.', addresses: [] }

  let addresses: string[]
  if (isIP(name)) addresses = [name]
  else {
    try {
      addresses = (await lookup(name, { all: true })).map((a) => a.address)
    } catch {
      return { allowed: false, reason: `${name} does not resolve.`, addresses: [] }
    }
  }
  if (addresses.length === 0)
    return { allowed: false, reason: `${name} does not resolve.`, addresses: [] }

  for (const ip of addresses) {
    const loopback = isLoopback(ip)
    if (loopback && opts.allowLoopback) continue
    if (isIP(ip) === 6 ? isPrivateV6(ip) : isPrivateV4(ip))
      return {
        allowed: false,
        reason: `${name} resolves to ${ip}, which is inside this network. Connection tests may only reach public addresses.`,
        addresses,
      }
  }
  return { allowed: true, addresses }
}
