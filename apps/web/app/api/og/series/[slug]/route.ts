import { z } from 'zod'
import { ogSeriesBySlug } from '@/lib/seo/og-data'
import { ogCardResponse, ogNotFound } from '@/lib/seo/og-route'

/**
 * GET /api/og/series/<slug>?v=<fingerprint> — the 1200×630 share card for a series
 * (docs/12 §2). `?v=` is the card's fingerprint: present and current, the response is
 * immutable for a year; absent or stale, it is still served but only cached for an hour.
 */

export const dynamic = 'force-dynamic'

const slugSchema = z.string().min(1).max(200)

export async function GET(request: Request, ctx: RouteContext<'/api/og/series/[slug]'>) {
  const { slug } = await ctx.params
  const parsed = slugSchema.safeParse(slug)
  if (!parsed.success) return ogNotFound()

  const row = await ogSeriesBySlug(parsed.data)
  if (!row) return ogNotFound()

  return ogCardResponse({
    request,
    row,
    chapter: null,
    version: new URL(request.url).searchParams.get('v'),
  })
}
