import { z } from 'zod'
import { cachedSeoSettings } from '@/lib/seo/settings'
import { readSitemapFile, SITEMAP_FILE_RE } from '@/lib/seo/sitemaps'
import { getStorage } from '@/lib/storage'

const paramsSchema = z.object({ file: z.string().regex(SITEMAP_FILE_RE) })

/** Gzipped child sitemaps written by the build (docs/12 §5), served as-is. */
export async function GET(_request: Request, ctx: RouteContext<'/sitemaps/[file]'>) {
  const settings = await cachedSeoSettings()
  if (!settings.sitemap.enabled) return Response.json({ error: 'not_found' }, { status: 404 })
  const parsed = paramsSchema.safeParse(await ctx.params)
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 })
  const body = await readSitemapFile(parsed.data.file, await getStorage())
  if (!body) return Response.json({ error: 'not_found' }, { status: 404 })
  return new Response(body as BodyInit, {
    headers: {
      'content-type': 'application/gzip',
      'content-length': String(body.byteLength),
      'cache-control': 'public, max-age=300, s-maxage=300',
      'x-content-type-options': 'nosniff',
    },
  })
}
