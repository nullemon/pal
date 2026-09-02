import { z } from 'zod'
import { serveFeed } from '@/lib/seo/feed-data'

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,199}$/i)

/** /series/<slug>/feed — that series' chapters. */
export async function GET(request: Request, ctx: RouteContext<'/series/[slug]/feed'>) {
  const { slug } = await ctx.params
  const parsed = slugSchema.safeParse(slug)
  if (!parsed.success) return Response.json({ error: 'not_found' }, { status: 404 })
  return serveFeed(request, { kind: 'series', slug: parsed.data.toLowerCase() })
}
