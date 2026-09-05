import { shiftBucket } from '@palscans/core'
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { executeRows } from '../client.js'
import { chapterStatsDaily, chapters, series, seriesStatsDaily } from '../schema/index.js'

/**
 * The admin analytics screen (docs/13 "Analytics"), reading the same daily tables the
 * rollup writes: `series_stats_daily` and `chapter_stats_daily`. Nothing here ever touches
 * `view_events` — that table is one row per viewer per chapter per day and only the rollup
 * has any business scanning it. Both daily tables carry a `bucket` index (migration 9015),
 * so every query below is a range scan over at most 90 days.
 *
 * All buckets are `YYYY-MM-DD` in UTC, exactly as the pipeline writes them; the viewer's
 * timezone never enters into the aggregation (docs/13 "timezone-aware display" applies to
 * rendering timestamps, not to which day a view belongs to).
 */

/** The windows the screen offers, in days, inclusive of today. */
export const ANALYTICS_WINDOWS = [7, 30, 90] as const
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number]
export const DEFAULT_ANALYTICS_WINDOW: AnalyticsWindow = 30

export const isAnalyticsWindow = (value: unknown): value is AnalyticsWindow =>
  typeof value === 'number' && (ANALYTICS_WINDOWS as readonly number[]).includes(value)

/**
 * `?window=30` → 30, anything else → the default. Never throws, and never salvages a
 * number out of something that is not one: `parseInt` would read `7; drop table` as 7,
 * `Number` reads it as NaN, which is what a query string that says nonsense deserves.
 */
export const parseAnalyticsWindow = (value: unknown): AnalyticsWindow => {
  const n = typeof value === 'string' ? Number(value.trim()) : value
  return isAnalyticsWindow(n) ? n : DEFAULT_ANALYTICS_WINDOW
}

export interface BucketRange {
  /** First day of the window, `YYYY-MM-DD` (UTC), inclusive. */
  from: string
  /** Last day of the window — today — `YYYY-MM-DD` (UTC), inclusive. */
  to: string
}

/**
 * The `days` buckets ending today, inclusive at both ends: a 7-day window on 2026-09-05 is
 * 2026-08-30 … 2026-09-05, seven buckets, not eight. This matches `windowStart()` in
 * @palscans/core, so "last 7 days" here and Popular Weekly on the site count the same days.
 */
export const analyticsWindow = (days: number, now: Date = new Date()): BucketRange => {
  const to = now.toISOString().slice(0, 10)
  return { from: shiftBucket(to, -(Math.max(1, Math.trunc(days)) - 1)), to }
}

/** Every bucket in `[from, to]`, ascending. Empty when the range is inverted. */
export const bucketsInRange = ({ from, to }: BucketRange): string[] => {
  const out: string[] = []
  for (let b = from; b <= to; b = shiftBucket(b, 1)) out.push(b)
  return out
}

export interface DayViews {
  bucket: string
  views: number
}

/**
 * Fill the gaps. A day with no traffic has no row in `series_stats_daily` at all, and a
 * line chart that skips it would draw a straight line across the quiet day instead of the
 * dip that actually happened.
 */
export const denseDays = (rows: readonly DayViews[], range: BucketRange): DayViews[] => {
  const byBucket = new Map(rows.map((r) => [r.bucket, Number(r.views)]))
  return bucketsInRange(range).map((bucket) => ({ bucket, views: byBucket.get(bucket) ?? 0 }))
}

const seriesInRange = (r: BucketRange) =>
  and(gte(seriesStatsDaily.bucket, r.from), lte(seriesStatsDaily.bucket, r.to))

const chapterInRange = (r: BucketRange) =>
  and(gte(chapterStatsDaily.bucket, r.from), lte(chapterStatsDaily.bucket, r.to))

/**
 * Site-wide views per day across the window, one entry per day with the quiet days zeroed.
 * Deleted series are included: the views happened, and dropping them would make the chart
 * disagree with the counters and with the dashboard tile.
 */
export const viewsByDay = async (db: Db, range: BucketRange): Promise<DayViews[]> => {
  const rows = await db
    .select({
      bucket: seriesStatsDaily.bucket,
      views: sql<number>`coalesce(sum(${seriesStatsDaily.views}), 0)::int`,
    })
    .from(seriesStatsDaily)
    .where(seriesInRange(range))
    .groupBy(seriesStatsDaily.bucket)
    .orderBy(asc(seriesStatsDaily.bucket))
  return denseDays(
    rows.map((r) => ({ bucket: r.bucket, views: Number(r.views) })),
    range,
  )
}

export interface TopSeriesRow {
  id: number
  slug: string
  title: string
  state: string
  /** Views inside the window. */
  views: number
  /** All-time views, the denormalised counter the rollup maintains. */
  viewCount: number
}

/** Top series by views inside the window. Soft-deleted series are left out — they are in
 * the trash and the row would link to a title staff has already removed. */
export const topSeriesByViews = async (
  db: Db,
  range: BucketRange,
  limit = 10,
): Promise<TopSeriesRow[]> => {
  const views = sql<number>`coalesce(sum(${seriesStatsDaily.views}), 0)::int`
  const rows = await db
    .select({
      id: series.id,
      slug: series.slug,
      title: series.title,
      state: series.state,
      viewCount: series.viewCount,
      views,
    })
    .from(seriesStatsDaily)
    .innerJoin(series, eq(series.id, seriesStatsDaily.seriesId))
    .where(and(seriesInRange(range), isNull(series.deletedAt)))
    .groupBy(series.id)
    .orderBy(desc(views), desc(series.viewCount))
    .limit(clampLimit(limit))
  return rows.map((r) => ({ ...r, views: Number(r.views), viewCount: Number(r.viewCount) }))
}

export interface TopChapterRow {
  id: number
  number: number
  title: string | null
  seriesId: number
  seriesTitle: string
  seriesSlug: string
  views: number
}

/** Top chapters by views inside the window, with the series they belong to. */
export const topChaptersByViews = async (
  db: Db,
  range: BucketRange,
  limit = 10,
): Promise<TopChapterRow[]> => {
  const views = sql<number>`coalesce(sum(${chapterStatsDaily.views}), 0)::int`
  const rows = await db
    .select({
      id: chapters.id,
      number: chapters.number,
      title: chapters.title,
      seriesId: series.id,
      seriesTitle: series.title,
      seriesSlug: series.slug,
      views,
    })
    .from(chapterStatsDaily)
    .innerJoin(chapters, eq(chapters.id, chapterStatsDaily.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(chapterInRange(range), isNull(chapters.deletedAt), isNull(series.deletedAt)))
    .groupBy(chapters.id, series.id)
    .orderBy(desc(views), desc(chapters.publishedAt))
    .limit(clampLimit(limit))
  return rows.map((r) => ({ ...r, number: Number(r.number), views: Number(r.views) }))
}

export interface ViewTotals {
  today: number
  /** Rolling: today and the six days before it. */
  week: number
  /** Rolling: today and the twenty-nine days before it. */
  month: number
  /** Every view ever recorded — `series.view_count`, which outlives the 90-day retention. */
  allTime: number
}

/**
 * The totals row. One statement over the last 30 buckets for the three windows (a filtered
 * aggregate, so the range is scanned once), and one over `series.view_count` for all-time —
 * which is the only number that survives `view_events` retention and the daily tables being
 * pruned, because the rollup keeps it as a running total.
 */
export const viewTotals = async (db: Db, now: Date = new Date()): Promise<ViewTotals> => {
  const month = analyticsWindow(30, now)
  const week = analyticsWindow(7, now)
  const [windows, allTime] = await Promise.all([
    executeRows<{ today: number; week: number; month: number }>(
      db,
      sql`
        select
          coalesce(sum(views) filter (where bucket = ${month.to}::date), 0)::bigint as today,
          coalesce(sum(views) filter (where bucket >= ${week.from}::date), 0)::bigint as week,
          coalesce(sum(views), 0)::bigint as month
        from ${seriesStatsDaily}
        where bucket between ${month.from}::date and ${month.to}::date
      `,
    ),
    db
      .select({ total: sql<number>`coalesce(sum(${series.viewCount}), 0)::bigint` })
      .from(series)
      .where(isNull(series.deletedAt)),
  ])
  const w = windows[0]
  return {
    today: Number(w?.today ?? 0),
    week: Number(w?.week ?? 0),
    month: Number(w?.month ?? 0),
    allTime: Number(allTime[0]?.total ?? 0),
  }
}

const clampLimit = (limit: number): number => Math.min(50, Math.max(1, Math.trunc(limit)))
