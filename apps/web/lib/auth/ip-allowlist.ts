/**
 * IPv4/IPv6 allowlist matching for the panel (docs/17 §C). Entries are plain addresses or
 * CIDR ranges; anything unparseable is ignored rather than silently allowing everyone.
 * Pure and dependency-free so the proxy can use it.
 */

const ipv4ToInt = (ip: string): number | null => {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let out = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    out = (out << 8) | n
  }
  return out >>> 0
}

/** Expands an IPv6 address to its 8 groups, or null when it is not one. */
const ipv6Groups = (ip: string): number[] | null => {
  const plain = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip
  if (!plain.includes(':')) return null
  const [head, tail] = plain.split('::', 2)
  const parse = (chunk: string) =>
    chunk === ''
      ? []
      : chunk
          .split(':')
          .map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? Number.parseInt(g, 16) : Number.NaN))
  const left = parse(head ?? '')
  const right = tail === undefined ? [] : parse(tail)
  if ([...left, ...right].some(Number.isNaN)) return null
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill(0), ...right]
  return groups.length === 8 ? groups : null
}

const matchesOne = (ip: string, entry: string): boolean => {
  const [range, bitsRaw] = entry.split('/', 2)
  if (!range) return false
  const bits = bitsRaw === undefined ? null : Number(bitsRaw)
  if (bits !== null && (!Number.isInteger(bits) || bits < 0)) return false

  const a4 = ipv4ToInt(ip)
  const r4 = ipv4ToInt(range)
  if (a4 !== null && r4 !== null) {
    const prefix = bits ?? 32
    if (prefix > 32) return false
    if (prefix === 0) return true
    const mask = (0xffffffff << (32 - prefix)) >>> 0
    return (a4 & mask) === (r4 & mask)
  }

  const a6 = ipv6Groups(ip)
  const r6 = ipv6Groups(range)
  if (a6 && r6) {
    const prefix = bits ?? 128
    if (prefix > 128) return false
    let left = prefix
    for (let i = 0; i < 8 && left > 0; i += 1) {
      const take = Math.min(16, left)
      const mask = take === 0 ? 0 : (0xffff << (16 - take)) & 0xffff
      if (((a6[i] ?? 0) & mask) !== ((r6[i] ?? 0) & mask)) return false
      left -= take
    }
    return true
  }
  return false
}

export const ipAllowed = (ip: string, allowlist: readonly string[]): boolean =>
  allowlist.some((entry) => matchesOne(ip, entry.trim()))
