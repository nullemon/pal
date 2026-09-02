import { getDb, series } from '@palscans/db'
import { and, ilike, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { ok, parseQuery, withPermission } from '@/lib/auth'

const q = z.object({ q: z.string().trim().min(1).max(100) })

/** GET /api/admin/series/search?q= — typeahead for relations and the uploader. */
export const GET = withPermission('series.read', async (request) => {
  const parsed = parseQuery(request, q)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const rows = await db
    .select({
      id: series.id,
      title: series.title,
      slug: series.slug,
      type: series.type,
      chapterCount: series.chapterCount,
    })
    .from(series)
    .where(
      and(
        isNull(series.deletedAt),
        or(ilike(series.title, `%${parsed.data.q}%`), ilike(series.slug, `%${parsed.data.q}%`)),
      ),
    )
    .limit(12)
  return ok(rows)
})
