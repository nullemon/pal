import { timingSafeEqual } from 'node:crypto'
import { cachedProxySnapshot, proxyToken } from '@/lib/seo/snapshot'

/**
 * The redirect / slug-history / indexing snapshot proxy.ts applies (see lib/seo/proxy.ts).
 *
 * The SEO half is public and cacheable — it describes URLs the crawler already sees. The
 * panel half is not: `staffPath` and `panelIps` were being served to anonymous callers,
 * which handed out the moved staff door and the exact addresses allowed to reach the panel.
 * Those two fields are returned only to the proxy, which proves itself with the same token
 * it already uses for /api/seo/hit, and that response is never cached.
 */
const fromProxy = (request: Request): boolean => {
  const given = Buffer.from(request.headers.get('x-proxy-token') ?? '')
  const expected = Buffer.from(proxyToken())
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function GET(request: Request) {
  const snapshot = await cachedProxySnapshot()
  if (!fromProxy(request)) {
    const { staffPath: _staffPath, panelIps: _panelIps, ...publicPart } = snapshot
    return Response.json(
      { data: { ...publicPart, staffPath: '', panelIps: [] } },
      { headers: { 'cache-control': 'public, max-age=60, s-maxage=60' } },
    )
  }
  return Response.json({ data: snapshot }, { headers: { 'cache-control': 'no-store' } })
}

/** Served per request (settings-driven); never prerendered at build time. */
export const dynamic = 'force-dynamic'
