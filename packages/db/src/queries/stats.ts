import { and, eq, gte, isNull, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import {
  bookmarks,
  chapterReads,
  chapters,
  ratings,
  readingProgress,
  series,
} from '../schema/index.js'

/**
 * Reading stats for the profile (docs/13 "Reading stats", docs/17 §G).
 *
 * Every number here is counted from a row the reader actually produced — `chapter_reads`,
 * `bookmarks`, `ratings`, `reading_progress`. Nothing records how long a page was on
 * screen, so there is no "time spent" and no "pages per session": inventing those from
 * chapter counts would be a guess dressed as a measurement.
 *
 * Days are UTC. `chapter_reads.read_at` is a timestamptz and the viewer's zone is only
 * known in the browser, so a streak computed server-side has to pick one zone; UTC is the
 * one the rest of the system already stores in.
 */

export interface ReadingMonth {
  /** `YYYY-MM`, UTC. */
  month: string
  chapters: number
}

export interface TopSeries {
  seriesId: number
  slug: string
  title: string
  type: string
  coverKey: string | null
  coverColor: string | null
  chaptersRead: number
}

export interface ReadingStats {
  chaptersRead: number
  seriesRead: number
  seriesFollowed: number
  seriesCompleted: number
  inProgress: number
  ratingsGiven: number
  averageRating: number | null
  daysRead: number
  currentStreak: number
  longestStreak: number
  firstReadAt: Date | null
  lastReadAt: Date | null
  /** Oldest month first; every month in the window is present, zeroes included. */
  months: ReadingMonth[]
  topSeries: TopSeries[]
}

const DAY_MS = 86_400_000

/** `YYYY-MM-DD` for a UTC instant. */
export const utcDay = (at: Date): string => at.toISOString().slice(0, 10)

const dayNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS)

/**
 * Longest and current run of consecutive days with at least one chapter read.
 *
 * `days` is a set of `YYYY-MM-DD` strings; order and duplicates do not matter. The current
 * streak counts back from today, and a streak that reached yesterday still counts — a
 * reader who has not opened anything yet at 09:00 has not broken it.
 */
export const streaks = (
  days: Iterable<string>,
  today: string,
): { current: number; longest: number } => {
  const sorted = [...new Set(days)]
    .map(dayNumber)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return { current: 0, longest: 0 }
  let longest = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === (sorted[i - 1] ?? 0) + 1 ? run + 1 : 1
    if (run > longest) longest = run
  }
  const last = sorted[sorted.length - 1] ?? 0
  const now = dayNumber(today)
  if (last < now - 1) return { current: 0, longest }
  // The trailing run, which the loop above already measured only if it is also the longest.
  let current = 1
  for (let i = sorted.length - 1; i > 0; i--) {
    if (sorted[i] === (sorted[i - 1] ?? 0) + 1) current++
    else break
  }
  return { current, longest }
}

/** The `count` most recent `YYYY-MM` keys, oldest first, ending with the month of `now`. */
export const monthWindow = (now: Date, count = 12): string[] => {
  const keys: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

/** First instant of the oldest month in a `monthWindow(now, count)`. */
export const monthWindowStart = (now: Date, count = 12): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1), 1))

export interface ReadingStatsOptions {
  /** Injected in tests so the window and the streak do not depend on the wall clock. */
  now?: Date
  months?: number
  topSeries?: number
}

/** Everything the /me/stats page shows, in one pass per fact. */
export const readingStats = async (
  db: Db,
  userId: number,
  opts: ReadingStatsOptions = {},
): Promise<ReadingStats> => {
  const now = opts.now ?? new Date()
  const monthCount = opts.months ?? 12
  const topCount = opts.topSeries ?? 5
  const windowStart = monthWindowStart(now, monthCount)

  const liveRead = and(
    eq(chapterReads.userId, userId),
    isNull(chapters.deletedAt),
    isNull(series.deletedAt),
  )

  const [totals] = await db
    .select({
      chaptersRead: sql<number>`count(*)::int`,
      seriesRead: sql<number>`count(distinct ${series.id})::int`,
      firstReadAt: sql<Date | null>`min(${chapterReads.readAt})`,
      lastReadAt: sql<Date | null>`max(${chapterReads.readAt})`,
    })
    .from(chapterReads)
    .innerJoin(chapters, eq(chapters.id, chapterReads.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(liveRead)

  const shelves = await db
    .select({ status: bookmarks.status, n: sql<number>`count(*)::int` })
    .from(bookmarks)
    .innerJoin(series, eq(series.id, bookmarks.seriesId))
    .where(and(eq(bookmarks.userId, userId), isNull(series.deletedAt)))
    .groupBy(bookmarks.status)

  const [rated] = await db
    .select({
      n: sql<number>`count(*)::int`,
      avg: sql<number | null>`avg(${ratings.score})`,
    })
    .from(ratings)
    .innerJoin(series, eq(series.id, ratings.seriesId))
    .where(and(eq(ratings.userId, userId), isNull(series.deletedAt)))

  const [progress] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(readingProgress)
    .innerJoin(series, eq(series.id, readingProgress.seriesId))
    .where(and(eq(readingProgress.userId, userId), isNull(series.deletedAt)))

  const monthRows = await db
    .select({
      month: sql<string>`to_char(${chapterReads.readAt} at time zone 'UTC', 'YYYY-MM')`,
      n: sql<number>`count(*)::int`,
    })
    .from(chapterReads)
    .innerJoin(chapters, eq(chapters.id, chapterReads.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(liveRead, gte(chapterReads.readAt, windowStart)))
    .groupBy(sql`1`)

  const dayRows = await db
    .selectDistinct({
      day: sql<string>`to_char(${chapterReads.readAt} at time zone 'UTC', 'YYYY-MM-DD')`,
    })
    .from(chapterReads)
    .innerJoin(chapters, eq(chapters.id, chapterReads.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(liveRead)

  const topRows = await db
    .select({
      seriesId: series.id,
      slug: series.slug,
      title: series.title,
      type: series.type,
      coverKey: series.coverKey,
      coverColor: series.coverColor,
      chaptersRead: sql<number>`count(*)::int`,
    })
    .from(chapterReads)
    .innerJoin(chapters, eq(chapters.id, chapterReads.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(liveRead)
    .groupBy(series.id, series.slug, series.title, series.type, series.coverKey, series.coverColor)
    .orderBy(sql`count(*) desc, ${series.title} asc`)
    .limit(topCount)

  const byMonth = new Map(monthRows.map((r) => [r.month, Number(r.n)]))
  const shelfCount = (status: string) =>
    shelves.filter((s) => s.status === status).reduce((sum, s) => sum + Number(s.n), 0)
  const { current, longest } = streaks(
    dayRows.map((r) => r.day),
    utcDay(now),
  )
  const avg = rated?.avg == null ? null : Number(rated.avg)

  return {
    chaptersRead: Number(totals?.chaptersRead ?? 0),
    seriesRead: Number(totals?.seriesRead ?? 0),
    seriesFollowed: shelves.reduce((sum, s) => sum + Number(s.n), 0),
    seriesCompleted: shelfCount('completed'),
    inProgress: Number(progress?.n ?? 0),
    ratingsGiven: Number(rated?.n ?? 0),
    averageRating: avg === null || Number.isNaN(avg) ? null : Math.round(avg * 10) / 10,
    daysRead: dayRows.length,
    currentStreak: current,
    longestStreak: longest,
    firstReadAt: totals?.firstReadAt ? new Date(totals.firstReadAt) : null,
    lastReadAt: totals?.lastReadAt ? new Date(totals.lastReadAt) : null,
    months: monthWindow(now, monthCount).map((month) => ({
      month,
      chapters: byMonth.get(month) ?? 0,
    })),
    topSeries: topRows.map((r) => ({ ...r, chaptersRead: Number(r.chaptersRead) })),
  }
}
