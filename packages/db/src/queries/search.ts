import { and, desc, inArray, or, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { series, seriesTitles } from '../schema/index.js'
import { publishedSeries, seriesCardColumns } from './_shared.js'

export interface SearchOptions {
  limit?: number
  /** Trigram similarity floor, default 0.25. */
  threshold?: number
}

export interface SearchResult {
  id: number
  slug: string
  title: string
  type: (typeof series.$inferSelect)['type']
  status: (typeof series.$inferSelect)['status']
  coverKey: string | null
  coverColor: string | null
  ratingAvg: number | null
  ratingCount: number
  chapterCount: number
  bookmarkCount: number
  viewCount: number
  lastChapterAt: Date | null
  isPinned: boolean
  isFeatured: boolean
  ageRating: string | null
  /** Combined relevance, higher is better. */
  score: number
  /** The alternative title that matched, when the main title did not. */
  matchedTitle: string | null
}

/**
 * Search: Postgres FTS on `series.search_vector` (prefix-matching every word) plus
 * pg_trgm similarity on `series.title` and `series_titles.title` for typos and aliases.
 */
export const searchSeries = async (
  db: Db,
  q: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> => {
  const query = q.trim().replace(/\s+/g, ' ')
  if (!query) return []
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20))
  const threshold = opts.threshold ?? 0.25

  const words = query
    .split(' ')
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
  const tsquery = words.length ? words.map((w) => `${w}:*`).join(' & ') : ''

  // Alternative titles that match by trigram or substring.
  const altMatches = await db
    .select({
      seriesId: seriesTitles.seriesId,
      title: seriesTitles.title,
      sim: sql<number>`greatest(similarity(${seriesTitles.title}, ${query}), case when ${seriesTitles.title} ilike ${`%${query}%`} then 0.6 else 0 end)`,
    })
    .from(seriesTitles)
    .where(
      or(
        sql`similarity(${seriesTitles.title}, ${query}) >= ${threshold}`,
        sql`${seriesTitles.title} ilike ${`%${query}%`}`,
      ),
    )
    .orderBy(desc(sql`similarity(${seriesTitles.title}, ${query})`))
    .limit(50)
  const altIds = [...new Set(altMatches.map((m) => m.seriesId))]
  const altBest = new Map<number, { title: string; sim: number }>()
  for (const m of altMatches) {
    const cur = altBest.get(m.seriesId)
    if (!cur || Number(m.sim) > cur.sim)
      altBest.set(m.seriesId, { title: m.title, sim: Number(m.sim) })
  }

  const ftsRank = tsquery
    ? sql<number>`coalesce(ts_rank(${series.searchVector}, to_tsquery('simple', ${tsquery})), 0)`
    : sql<number>`0`
  const trgm = sql<number>`similarity(${series.title}, ${query})`
  const substring = sql<number>`case when ${series.title} ilike ${`%${query}%`} then 0.5 else 0 end`
  const score = sql<number>`(${ftsRank} * 2 + ${trgm} + ${substring})`

  const conditions = [
    sql`${series.title} ilike ${`%${query}%`}`,
    sql`${trgm} >= ${threshold}`,
    ...(tsquery ? [sql`${series.searchVector} @@ to_tsquery('simple', ${tsquery})`] : []),
    ...(altIds.length ? [inArray(series.id, altIds)] : []),
  ]

  const rows = await db
    .select({ ...seriesCardColumns, score })
    .from(series)
    .where(and(publishedSeries(), or(...conditions)))
    .orderBy(desc(score), desc(series.viewCount))
    .limit(limit)

  return rows
    .map((r) => {
      const alt = altBest.get(r.id)
      const altBoost = alt ? alt.sim : 0
      const matchedTitle =
        alt && !r.title.toLowerCase().includes(query.toLowerCase()) ? alt.title : null
      return { ...r, score: Number(r.score) + altBoost, matchedTitle }
    })
    .sort((a, b) => b.score - a.score)
}

/** Simple prefix suggestions for the search box (typeahead). */
export const suggestSeries = (db: Db, q: string, limit = 8) =>
  db
    .select({
      id: series.id,
      slug: series.slug,
      title: series.title,
      type: series.type,
      coverKey: series.coverKey,
    })
    .from(series)
    .where(and(publishedSeries(), sql`${series.title} ilike ${`${q.trim()}%`}`))
    .orderBy(desc(series.viewCount))
    .limit(limit)

export const seriesByIds = (db: Db, ids: number[]) =>
  ids.length === 0
    ? Promise.resolve([])
    : db
        .select(seriesCardColumns)
        .from(series)
        .where(and(inArray(series.id, ids), publishedSeries()))
