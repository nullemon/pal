import { createHash } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
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
    const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
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

export const proxy = composeProxy([storageGuard, seoRules])

export const config = {
  matcher: [
    '/_storage/:path*',
    '/api/storage/:path*',
    // Everything else except `/`, Next internals, the storage host, the API and static files
    // (README: the home page and its ISR data stay outside the proxy).
    '/((?!api/|_next/|_storage/|favicon\\.ico|.+\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|css|js|map|woff2?|json|xml|gz)$)[^/].*)',
  ],
}
