import type { NextRequest } from 'next/server'
import { randomSeriesSlug } from '@/components/discovery/queries'

export const dynamic = 'force-dynamic'

/**
 * /random → 307 to a random published series (docs/13 "Random series"), /browse when the
 * catalogue is empty. The Location is relative so it stays on whatever host served it, and
 * the response is never cached — each hit is a new roll.
 */
export async function GET(_request: NextRequest) {
  const slug = await randomSeriesSlug()
  return new Response(null, {
    status: 307,
    headers: {
      Location: slug ? `/series/${slug}` : '/browse',
      'Cache-Control': 'no-store',
    },
  })
}
