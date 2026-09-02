import { cachedProxySnapshot } from '@/lib/seo/snapshot'

/**
 * The redirect / slug-history / indexing snapshot proxy.ts applies (see lib/seo/proxy.ts).
 * Public and cacheable: nothing in it is secret (the IndexNow key is served at /<key>.txt).
 */
export async function GET() {
  const snapshot = await cachedProxySnapshot()
  return Response.json(
    { data: snapshot },
    { headers: { 'cache-control': 'public, max-age=60, s-maxage=60' } },
  )
}

/** Served per request (settings-driven); never prerendered at build time. */
export const dynamic = 'force-dynamic'
