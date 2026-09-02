/**
 * The pure half of apps/web/proxy.ts (docs/12 §1, §7, §10): host canonicalisation, trailing
 * slashes, the redirects table, slug_history 301s, 410 for removed series, the IndexNow key
 * file and the site-wide X-Robots-Tag. `resolveProxy` takes a snapshot of the rules (served
 * by /api/seo/snapshot, cached in the proxy for 60s) so it is unit-testable without Next.
 */

/** Strip a trailing slash (except the root) — docs/12 §1. Local copy: this file must stay free of server imports. */
export const normalisePath = (pathname: string): string =>
  pathname.length > 1 && pathname.endsWith('/') ? pathname.replace(/\/+$/, '') || '/' : pathname

export interface ProxySnapshot {
  /** Canonical host (`palscans.org`); `www.` → apex 301. */
  canonicalHost: string | null
  /** docs/12 §7 "Site indexable" — off → `X-Robots-Tag: noindex` on every response. */
  indexable: boolean
  /** redirects table: from path → target. */
  redirects: Record<string, { to: string; status: 301 | 302 }>
  /** slug_history: entity type → old slug → current slug. */
  slugs: {
    series: Record<string, string>
    genre: Record<string, string>
    announcement: Record<string, string>
  }
  /** Removed series slugs → 410 Gone. */
  gone: string[]
  indexnowKey: string | null
}

export const EMPTY_SNAPSHOT: ProxySnapshot = {
  canonicalHost: null,
  indexable: true,
  redirects: {},
  slugs: { series: {}, genre: {}, announcement: {} },
  gone: [],
  indexnowKey: null,
}

export type ProxyDecision =
  | { kind: 'redirect'; location: string; status: 301 | 302; hit?: string }
  | { kind: 'gone'; slug: string }
  | { kind: 'text'; body: string }
  | { kind: 'next'; headers: Record<string, string> }

const ENTITY_PREFIX: Record<'series' | 'genre' | 'announcement', string> = {
  series: '/series/',
  genre: '/genres/',
  announcement: '/announcements/',
}

/** True when the request host is the `www.` variant of the canonical apex. */
export const isWwwOfCanonical = (host: string, canonical: string | null): boolean => {
  if (!canonical) return false
  const h = host.toLowerCase().replace(/:\d+$/, '')
  return h !== canonical && h === `www.${canonical}`
}

export function resolveProxy(snapshot: ProxySnapshot, url: URL): ProxyDecision {
  const headers: Record<string, string> = {}
  if (!snapshot.indexable) headers['x-robots-tag'] = 'noindex, nofollow'

  // www → apex, keeping path + query (docs/12 §1: one canonical host).
  if (isWwwOfCanonical(url.host, snapshot.canonicalHost)) {
    const target = new URL(url.toString())
    target.host = snapshot.canonicalHost as string
    target.protocol = 'https:'
    return { kind: 'redirect', location: target.toString(), status: 301 }
  }

  // Trailing slash → 301 to the variant without.
  const path = normalisePath(url.pathname)
  if (path !== url.pathname) {
    return { kind: 'redirect', location: `${path}${url.search}`, status: 301 }
  }

  // IndexNow key file: /<key>.txt
  if (snapshot.indexnowKey && path === `/${snapshot.indexnowKey}.txt`) {
    return { kind: 'text', body: snapshot.indexnowKey }
  }

  // Redirects table — exact path match, query preserved for relative targets.
  const rule = snapshot.redirects[path]
  if (rule) {
    const location = /^https?:\/\//.test(rule.to) ? rule.to : `${rule.to}${url.search}`
    return { kind: 'redirect', location, status: rule.status, hit: path }
  }

  // Slug history and removed series.
  for (const entity of ['series', 'genre', 'announcement'] as const) {
    const prefix = ENTITY_PREFIX[entity]
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    const slash = rest.indexOf('/')
    const slug = decodeSlug(slash === -1 ? rest : rest.slice(0, slash))
    const tail = slash === -1 ? '' : rest.slice(slash)
    if (!slug) break
    if (entity === 'series' && snapshot.gone.includes(slug)) return { kind: 'gone', slug }
    const current = snapshot.slugs[entity][slug]
    if (current && current !== slug) {
      return { kind: 'redirect', location: `${prefix}${current}${tail}${url.search}`, status: 301 }
    }
    break
  }

  return { kind: 'next', headers }
}

const decodeSlug = (raw: string): string | null => {
  try {
    return decodeURIComponent(raw).toLowerCase()
  } catch {
    return null
  }
}
