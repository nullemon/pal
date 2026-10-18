import { createHash } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { ipAllowed } from '@/lib/auth/ip-allowlist'
import { clientIp } from '@/lib/auth/rate-limit'
import { SESSION_COOKIE } from '@/lib/auth/session'
import { STAFF_PATH_DEFAULT } from '@/lib/auth/staff-path'
import { goneHtml } from '@/lib/seo/gone'
import { EMPTY_SNAPSHOT, type ProxySnapshot, resolveProxy } from '@/lib/seo/proxy'

/**
 * Next 16 proxy (formerly middleware.ts; always the Node.js runtime). Shared file, owned by
 * P6 — extend it with `composeProxy` rather than editing the handlers:
 *
 *   const proxy = composeProxy([storageGuard, seoRules, yourHandler])
 *
 * A handler returns a `Response` to short-circuit, or `undefined` to pass on; it may add
 * response headers through `ctx.headers` (applied to the final `NextResponse.next()`).
 * Handlers run in order. Keep them free of database imports: the SEO rules come from a
 * 60s-cached snapshot fetched over loopback (`/api/seo/snapshot`), so the proxy stays small
 * and boots even when the database is slow.
 *
 * What the SEO handler does (docs/12 §1, §7, §10): `www.` → apex 301, trailing-slash 301,
 * the redirects table (with hit counts), slug_history 301s for series / genres /
 * announcements, 410 Gone for removed series, the IndexNow key file at /<key>.txt and
 * `X-Robots-Tag: noindex` on every response when the site is not indexable.
 */

export interface ProxyContext {
  pathname: string
  /** Response headers for the pass-through case. */
  headers: Headers
}

export type ProxyHandler = (
  request: NextRequest,
  ctx: ProxyContext,
) => Response | undefined | Promise<Response | undefined>

export function composeProxy(handlers: readonly ProxyHandler[]) {
  return async (request: NextRequest): Promise<Response> => {
    const ctx: ProxyContext = { pathname: request.nextUrl.pathname, headers: new Headers() }
    for (const handler of handlers) {
      const response = await handler(request, ctx)
      if (response) return response
    }
    const response = NextResponse.next()
    for (const [key, value] of ctx.headers.entries()) response.headers.set(key, value)
    return response
  }
}

/**
 * Storage host: a path with malformed percent-encoding (`/_storage/%E0%A4%A`) makes Next's
 * router throw a DecodeError before any route handler runs, and the App Router has no /400
 * page, so it surfaced as a bare 500. Answer with the handler's own `{ error }` 404 instead.
 */
export const storageGuard: ProxyHandler = (_request, ctx) => {
  try {
    decodeURIComponent(ctx.pathname)
  } catch {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return undefined
}

// ---- SEO rules ---------------------------------------------------------------------------

const SNAPSHOT_TTL_MS = 60_000
let snapshotCache: { at: number; value: ProxySnapshot } | undefined
let snapshotInFlight: Promise<ProxySnapshot> | undefined

const proxyToken = (): string =>
  createHash('sha256')
    .update(`proxy:${process.env.SESSION_SECRET ?? ''}`)
    .digest('hex')

async function fetchSnapshot(request: NextRequest): Promise<ProxySnapshot> {
  const url = new URL('/api/seo/snapshot', request.nextUrl.origin)
  try {
    // The token is what entitles this fetch to the panel fields (staff path, IP allowlist).
    // Without it the route serves the SEO rules only, so a public request cannot read them.
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-proxy-token': proxyToken() },
      cache: 'no-store',
    })
    if (!res.ok) return snapshotCache?.value ?? EMPTY_SNAPSHOT
    const json = (await res.json()) as { data?: ProxySnapshot }
    return json.data ?? EMPTY_SNAPSHOT
  } catch {
    return snapshotCache?.value ?? EMPTY_SNAPSHOT
  }
}

async function getSnapshot(request: NextRequest): Promise<ProxySnapshot> {
  const now = Date.now()
  if (snapshotCache && now - snapshotCache.at < SNAPSHOT_TTL_MS) return snapshotCache.value
  snapshotInFlight ??= fetchSnapshot(request).then((value) => {
    snapshotCache = { at: Date.now(), value }
    snapshotInFlight = undefined
    return value
  })
  return snapshotInFlight
}

const SITE_NAME = process.env.SITE_NAME || 'PALScans'

export const seoRules: ProxyHandler = async (request, ctx) => {
  if (ctx.pathname.startsWith('/api/') || ctx.pathname.startsWith('/_storage/')) return undefined
  const snapshot = await getSnapshot(request)
  const decision = resolveProxy(snapshot, request.nextUrl)
  switch (decision.kind) {
    case 'redirect': {
      if (decision.hit) {
        // Count the hit without delaying the redirect.
        void fetch(new URL('/api/seo/hit', request.nextUrl.origin), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-proxy-token': proxyToken() },
          body: JSON.stringify({ path: decision.hit }),
          cache: 'no-store',
        }).catch(() => undefined)
      }
      const target = /^https?:\/\//.test(decision.location)
        ? decision.location
        : new URL(decision.location, request.nextUrl.origin)
      return NextResponse.redirect(target, decision.status)
    }
    case 'gone':
      return new Response(goneHtml(SITE_NAME), {
        status: 410,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=3600',
          'x-robots-tag': 'noindex',
        },
      })
    case 'text':
      return new Response(decision.body, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'public, max-age=3600',
        },
      })
    default:
      for (const [k, v] of Object.entries(decision.headers)) ctx.headers.set(k, v)
      return undefined
  }
}

/**
 * Access rules for the panel (docs/17 §C), from the same 60s snapshot as the SEO rules.
 *
 * Two separate things, and it matters which is which:
 *  - `staffPath` MOVES the staff sign-in and 404s the default. That is obscurity: it trims
 *    the automated scanner traffic that hammers well-known admin paths, and nothing more.
 *  - `panelIps` RESTRICTS who reaches the panel at all. That is the actual control, and it
 *    needs TRUSTED_PROXY set or every request carries the proxy's own address.
 *
 * Both answer 404 rather than 403, so a probe cannot tell a wrong address from a wrong path.
 */
export const staffAccess: ProxyHandler = async (request, ctx) => {
  const path = ctx.pathname
  // The admin API counts as the panel. It was not included, so an allowlist that 404'd every
  // admin page still let every admin *mutation* through from any address — the control that
  // is meant to be the real one, unlike the moved path, which is only obscurity.
  const isPanel = path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/')
  const snapshot = await getSnapshot(request)
  const staffPath = snapshot.staffPath || STAFF_PATH_DEFAULT
  const moved = staffPath !== STAFF_PATH_DEFAULT

  if (!isPanel && path !== staffPath) return undefined

  if (snapshot.panelIps.length > 0) {
    const ip = clientIp(request)
    if (!ip || !ipAllowed(ip, snapshot.panelIps)) return notFoundResponse()
  }

  // The moved door answers on its own path, and the default stops existing.
  if (moved) {
    if (path === staffPath) {
      const url = request.nextUrl.clone()
      url.pathname = STAFF_PATH_DEFAULT
      return NextResponse.rewrite(url)
    }
    if (path === STAFF_PATH_DEFAULT) return notFoundResponse()
  }
  return undefined
}

const notFoundResponse = () =>
  new Response(null, { status: 404, headers: { 'x-robots-tag': 'noindex' } })

/**
 * Which paths an anonymous reader may be served from a shared cache.
 *
 * Deliberately a list rather than "everything public". A page qualifies only if its
 * signed-out render is the same for every signed-out reader — the series page, the reader,
 * and the discovery surfaces are, because `getAppUser()` returns null for all of them and
 * every per-reader decision (`canRead`, bookmark, rating, progress, ads) is computed from
 * that null. Anything that might key on the visitor cookie stays off the list.
 */
const CACHEABLE_PUBLIC = [
  /^\/series\/[^/]+$/,
  /^\/series\/[^/]+\/chapter-[^/]+$/,
  /^\/browse$/,
  /^\/genres\/[^/]+$/,
]

/**
 * Sixty seconds at the edge, five minutes of stale-while-revalidate.
 *
 * Short on purpose: a chapter going live has to appear quickly, and the publish path already
 * purges the catalogue. The win is not the TTL, it is that a release-day crowd arriving at
 * one chapter is one render instead of ten thousand.
 */
const PUBLIC_TTL = 'public, s-maxage=60, stale-while-revalidate=300'

/**
 * Let a shared cache hold the signed-out render of the reader-facing pages (docs/20).
 *
 * The measured problem: the series and chapter pages are rendered from scratch for every
 * visitor, costing ~30 ms of CPU each, and on one core that caps the site at about twenty
 * pages a second however many readers arrive. Almost all of that traffic is signed out and
 * every signed-out render is byte-identical, so it is the same page built ten thousand times.
 *
 * Two things make this safe rather than a way to serve one reader's page to another:
 *
 *  1. **Only when there is no session.** A request carrying `sid` is marked `private,
 *     no-store` and never enters a shared cache. So nothing personalised is ever cacheable,
 *     and the paywall is unaffected: a signed-out render already shows locked chapters
 *     locked, because `canReadChapter` was given a null user.
 *  2. **A page render cannot set a cookie.** Next throws if a server component tries, so the
 *     visitor id is minted by route handlers only (`lib/visitor.ts`). A cached page therefore
 *     carries no `Set-Cookie` to hand one browser's identity to the next.
 *
 * `Vary: Cookie` is deliberately *not* set. It reads as the careful choice and is the
 * opposite: the visitor cookie is unique per browser, so varying on it gives every reader
 * their own cache entry and caches nothing at all. Keeping signed-in readers off the cached
 * copy is the edge's job — a Cloudflare cache rule that bypasses when `sid` is present —
 * which is why the signed-in branch below is explicit rather than merely absent.
 */
export const publicCache: ProxyHandler = (request, ctx) => {
  if (request.method !== 'GET') return undefined
  if (!CACHEABLE_PUBLIC.some((re) => re.test(ctx.pathname))) return undefined
  if (request.cookies.get(SESSION_COOKIE)) {
    // Said rather than left unsaid: an intermediary that would otherwise apply its own
    // default must be told this response belongs to one reader.
    ctx.headers.set('cache-control', 'private, no-store')
    return undefined
  }
  ctx.headers.set('cache-control', PUBLIC_TTL)
  return undefined
}

export const proxy = composeProxy([storageGuard, staffAccess, seoRules, publicCache])

export const config = {
  matcher: [
    '/_storage/:path*',
    '/api/storage/:path*',
    // The admin API must go through `staffAccess` too. The catch-all below excludes `api/`,
    // so without this the panel IP allowlist only ever 404'd admin *pages* while every
    // mutation under /api/admin stayed reachable from any address.
    '/api/admin/:path*',
    // Everything else except `/`, Next internals, the storage host, the API and static files
    // (README: the home page and its ISR data stay outside the proxy).
    '/((?!api/|_next/|_storage/|favicon\\.ico|.+\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|css|js|map|woff2?|json|xml|gz)$)[^/].*)',
  ],
}
