import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { search } from '@/components/discovery/queries'
import { rateLimited } from '@/lib/auth'
import { searchActor, searchLimit } from '@/lib/search/rate-limit'

/**
 * GET /api/search?q=&limit= — the typeahead / ⌘K palette backend, on the same
 * `searchSeries` helper as the page (Postgres FTS + trigram). `{ data }` or `{ error }`.
 *
 * Budgeted per identity before it reaches the database. `Cache-Control: s-maxage=60` in
 * front only helps when two callers ask the same thing, and the caller chooses `q`; the
 * query underneath is two round trips, one of which cannot use the trigram index (see
 * `lib/search/rate-limit`). The parse comes first because it is free, then the budget, then
 * the search.
 */
const querySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .transform((s) => s.replace(/\s+/g, ' ')),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) {
    return Response.json(
      {
        error: 'validation',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      { status: 400 },
    )
  }
  const budget = await searchLimit(await searchActor(request))
  if (!budget.ok) return rateLimited(budget.retryAfterSec)
  const { q, limit } = parsed.data
  const hits = await search(q, limit)
  return Response.json(
    {
      data: {
        q,
        results: hits.map((h) => ({
          id: h.id,
          slug: h.slug,
          title: h.title,
          type: h.type,
          status: h.status,
          cover: h.coverSrc,
          rating: h.ratingCount > 0 ? h.rating : null,
          chapterCount: h.chapterCount,
          matchedTitle: h.matchedTitle,
          href: h.href,
        })),
      },
    },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
  )
}
