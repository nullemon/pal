import { z } from 'zod'
import { fail, getRateLimiter, ok, rateLimited, withPermission } from '@/lib/auth'
import { searchMetadata } from '@/lib/metadata/anilist'

/**
 * GET /api/admin/metadata/search?q= — candidates for a title, from AniList.
 *
 * Read-only and creates nothing: the panel shows what came back and the operator picks. The
 * request goes out from the server rather than the browser so one rate limit covers the whole
 * site instead of each admin's tab having its own, and so no admin's IP is handed to AniList.
 *
 * Limited per admin because every call reaches a third party who is doing us a favour. The
 * ceiling is generous for a person typing and immediate for a script.
 */
const query = z.object({ q: z.string().min(2).max(120) })

export const GET = withPermission('series.update', async (request, _ctx, user) => {
  const parsed = query.safeParse({ q: new URL(request.url).searchParams.get('q') ?? '' })
  if (!parsed.success) return ok({ results: [] })

  const hit = await getRateLimiter().hit(`metadata-search:${user.id}`, 40, 60)
  if (!hit.ok) return rateLimited(hit.retryAfterSec)

  const res = await searchMetadata(parsed.data.q)
  if (!res.ok)
    return res.code === 'rate_limited'
      ? rateLimited(res.retryAfterSec)
      : fail(502, 'source_unavailable')
  return ok({ results: res.data })
})
