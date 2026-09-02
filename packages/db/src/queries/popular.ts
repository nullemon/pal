import { bucketKey, type PopularityWindow, windowStart } from '@palscans/core'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { series, seriesStatsDaily } from '../schema/index.js'
import { publishedSeries, seriesCardColumns } from './_shared.js'

export interface PopularOptions {
  limit?: number
  now?: Date
}

export interface PopularItem {
  rank: number
  views: number
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
}

/**
 * Popular Weekly / Monthly / All-time (docs/02 "Views and ranking"): windows aggregate
 * `series_stats_daily`; all-time uses the denormalised `series.view_count`.
 * Cache the result for ~5 minutes at the call site.
 */
export const popular = async (
  db: Db,
  window: PopularityWindow,
  opts: PopularOptions = {},
): Promise<PopularItem[]> => {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 10))
  const start = windowStart(window, opts.now)

  if (start === null) {
    const rows = await db
      .select({ ...seriesCardColumns, views: series.viewCount })
      .from(series)
      .where(publishedSeries())
      .orderBy(desc(series.viewCount), desc(series.ratingAvg))
      .limit(limit)
    return rows.map((r, i) => ({ ...r, views: Number(r.views), rank: i + 1 }))
  }

  const views = sql<number>`coalesce(sum(${seriesStatsDaily.views}), 0)::int`
  const rows = await db
    .select({ ...seriesCardColumns, views })
    .from(seriesStatsDaily)
    .innerJoin(series, eq(series.id, seriesStatsDaily.seriesId))
    .where(and(publishedSeries(), gte(seriesStatsDaily.bucket, bucketKey(start))))
    .groupBy(series.id)
    .orderBy(desc(views), desc(series.ratingAvg))
    .limit(limit)
  return rows.map((r, i) => ({ ...r, views: Number(r.views), rank: i + 1 }))
}
