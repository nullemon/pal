/**
 * Link detection for the "links are held by default" policy (docs/14 §2):
 * URLs, bare domains (example.com), obfuscated ones (example[dot]com, hxxp://),
 * Discord invites and Telegram handles.
 */
export type LinkKind = 'url' | 'bare_domain' | 'obfuscated' | 'discord' | 'telegram'

export interface DetectedLink {
  kind: LinkKind
  /** The raw matched text. */
  match: string
  /** Best-effort normalised host (lowercase, no scheme/path), for the allowlist check. */
  domain: string | null
}

// Long TLD list is unnecessary: any dotted label sequence whose last label is 2+ letters
// counts as a domain. Numbers like "9.6" are excluded by requiring an alphabetic TLD.
const URL_RE =
  /\b(?:https?|hxxps?|ftp):\/\/[^\s<>"'`)\]]+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"'`)\]]*)?/gi
const BARE_RE =
  /(?<![\w@./-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s<>"'`)\]]*)?(?![\w.-])/gi
const OBFUSCATED_RE =
  /\b[a-z0-9-]+(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\}|\s+dot\s+|\[\s*\.\s*\]|\(\s*\.\s*\)|\{\s*\.\s*\}|\s+\.\s+)\s*[a-z0-9-]+)+\b/gi
const DISCORD_RE = /\b(?:discord(?:app)?\.com\/invite\/|discord\.gg\/|dsc\.gg\/)[\w-]+/gi
const TELEGRAM_RE = /\b(?:t\.me\/|telegram\.me\/|telegram\.dog\/)[\w-]+/gi

// Things that look like domains but are chapter/version numbers or file names.
const FALSE_POSITIVE_TLDS = new Set(['js', 'ts', 'md', 'txt', 'json', 'css'])

export const domainOf = (text: string): string | null => {
  let s = text.trim().toLowerCase()
  s = s.replace(/^(?:hxxps?|https?|ftp):\/\//, '').replace(/^www\./, '')
  s = s
    .replace(
      /\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\}|\[\s*\.\s*\]|\(\s*\.\s*\)|\{\s*\.\s*\})\s*/g,
      '.',
    )
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s+\.\s+/g, '.')
  const host = s.split(/[/?#:]/)[0] ?? ''
  return host.includes('.') ? host : null
}

// Zero-width / soft-hyphen characters that hide inside a label without changing how it reads.
const INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g
// Unicode full stops that render like '.': ideographic, fullwidth, one-dot leader, hyphenation point.
const UNICODE_DOT_RE = /[\u3002\uFF0E\u2024\u2027]/g
// "example . com", "example (.) com", "example [.] com" — a dot set off by spaces or brackets.
const SPACED_DOT_RE = /(?<=[a-z0-9])(?:\s+\.\s+|\s*[[({]\s*\.\s*[\])}]\s*)(?=[a-z0-9])/gi

/**
 * Fold the obfuscations that still read as a domain to a human: compatibility forms
 * (fullwidth letters), invisible joiners, Unicode full stops and spaced / bracketed dots.
 * Detection runs over the normalised text; a match that does not occur literally in the
 * original counts as `obfuscated` (never allowlisted).
 */
export const normaliseForLinks = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(INVISIBLE_RE, '')
    .replace(UNICODE_DOT_RE, '.')
    .replace(SPACED_DOT_RE, '.')

export const detectLinks = (raw: string): DetectedLink[] => {
  const text = normaliseForLinks(raw)
  const original = raw.toLowerCase()
  const literal = (m: string) => original.includes(m.toLowerCase())
  const out: DetectedLink[] = []
  const covered: Array<[number, number]> = []
  const overlaps = (start: number, end: number) => covered.some(([s, e]) => start < e && end > s)
  const push = (kind: LinkKind, m: RegExpMatchArray) => {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (overlaps(start, end)) return
    covered.push([start, end])
    out.push({ kind, match: m[0], domain: domainOf(m[0]) })
  }

  for (const m of text.matchAll(DISCORD_RE)) push('discord', m)
  for (const m of text.matchAll(TELEGRAM_RE)) push('telegram', m)
  for (const m of text.matchAll(URL_RE))
    push(/^hxxp/i.test(m[0]) || !literal(m[0]) ? 'obfuscated' : 'url', m)
  for (const m of text.matchAll(OBFUSCATED_RE)) push('obfuscated', m)
  for (const m of text.matchAll(BARE_RE)) {
    const tld = m[0].split('/')[0]?.split('.').pop()?.toLowerCase() ?? ''
    if (FALSE_POSITIVE_TLDS.has(tld)) continue
    push(literal(m[0]) ? 'bare_domain' : 'obfuscated', m)
  }
  return out.sort((a, b) => text.indexOf(a.match) - text.indexOf(b.match))
}

export const hasLink = (text: string): boolean => detectLinks(text).length > 0

/** True when every detected link's domain is on the allowlist (subdomains included). */
export const allAllowlisted = (
  links: readonly DetectedLink[],
  allowlist: Iterable<string>,
): boolean => {
  const allowed = Array.from(allowlist, (d) => d.toLowerCase().replace(/^www\./, ''))
  return links.every((l) => {
    if (l.kind === 'obfuscated') return false
    if (!l.domain) return false
    return allowed.some((a) => l.domain === a || l.domain?.endsWith(`.${a}`))
  })
}
