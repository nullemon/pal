import { cachedSeoSettings } from '@/lib/seo/settings'
import { buildSitemaps, readSitemapIndex } from '@/lib/seo/sitemaps'

/**
 * The sitemap index (docs/12 §5). Served from the last build in storage; when nothing has
 * been built yet (fresh install) a full build runs once, on demand. 404 when the sitemap is
 * disabled in admin.
 */
export async function GET() {
  const settings = await cachedSeoSettings()
  if (!settings.sitemap.enabled) return Response.json({ error: 'not_found' }, { status: 404 })
  let xml = await readSitemapIndex()
  if (!xml) {
    const result = await buildSitemaps({ kind: 'full' })
    if (result.error) return Response.json({ error: 'build_failed' }, { status: 503 })
    xml = await readSitemapIndex()
  }
  if (!xml) return Response.json({ error: 'not_found' }, { status: 404 })
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** Served per request (settings-driven); never prerendered at build time. */
export const dynamic = 'force-dynamic'
