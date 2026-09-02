import { and, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { chapters, series } from '../schema/index.js'
import {
  chapterRowColumns,
  clampPage,
  count,
  publishedChapters,
  publishedSeries,
  seriesCardColumns,
} from './_shared.js'

export interface HomeFeedOptions {
  page?: number
  pageSize?: number
  /** Chapters per series, default 3. */
  chaptersPerSeries?: number
}

export interface HomeFeedChapter {
  id: number
  number: number
  title: string | null
  isPremium: boolean
  earlyAccessUntil: Date | null
  publishedAt: Date | null
}

export interface HomeFeedItem {
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
  chapters: HomeFeedChapter[]
}

export interface HomeFeed {
  items: HomeFeedItem[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

/**
 * Latest updates: published series ordered pinned-first then by last_chapter_at, each with
 * its N most recent published chapters. Real `?page=` pagination (docs/06).
 */
export const homeFeed = async (db: Db, opts: HomeFeedOptions = {}): Promise<HomeFeed> => {
  const { page, pageSize } = clampPage(opts.page, opts.pageSize)
  const perSeries = Math.min(10, Math.max(1, opts.chaptersPerSeries ?? 3))
  const where = and(publishedSeries(), isNotNull(series.lastChapterAt))

  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select(seriesCardColumns)
      .from(series)
      .where(where)
      .orderBy(desc(series.isPinned), desc(series.lastChapterAt), desc(series.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(series).where(where),
  ])

  const ids = rows.map((r) => r.id)
  // Rank chapters per series in SQL and keep only the top N there, so a 400-chapter
  // series contributes N rows to the page, not 400.
  const latestFor = (seriesIds: number[]) => {
    const ranked = db.$with('ranked').as(
      db
        .select({
          id: chapterRowColumns.id,
          seriesId: chapterRowColumns.seriesId,
          number: chapterRowColumns.number,
          title: chapterRowColumns.title,
          isPremium: chapterRowColumns.isPremium,
          earlyAccessUntil: chapterRowColumns.earlyAccessUntil,
          publishedAt: chapterRowColumns.publishedAt,
          rn: sql<number>`row_number() over (partition by ${chapters.seriesId} order by ${chapters.number} desc)`.as(
            'rn',
          ),
        })
        .from(chapters)
        .where(and(inArray(chapters.seriesId, seriesIds), publishedChapters())),
    )
    return db
      .with(ranked)
      .select({
        id: ranked.id,
        seriesId: ranked.seriesId,
        number: ranked.number,
        title: ranked.title,
        isPremium: ranked.isPremium,
        earlyAccessUntil: ranked.earlyAccessUntil,
        publishedAt: ranked.publishedAt,
      })
      .from(ranked)
      .where(lte(ranked.rn, perSeries))
      .orderBy(ranked.seriesId, desc(ranked.number))
  }
  const latest = ids.length === 0 ? [] : await latestFor(ids)

  const bySeries = new Map<number, HomeFeedChapter[]>()
  for (const c of latest) {
    const list = bySeries.get(c.seriesId) ?? []
    list.push({
      id: c.id,
      number: c.number,
      title: c.title,
      isPremium: c.isPremium,
      earlyAccessUntil: c.earlyAccessUntil,
      publishedAt: c.publishedAt,
    })
    bySeries.set(c.seriesId, list)
  }

  return {
    items: rows.map((r) => ({
      ...r,
      chapters: (bySeries.get(r.id) ?? []).sort((a, b) => b.number - a.number),
    })),
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  }
}

/** Series flagged for the hero carousel. */
export const featuredSeries = (db: Db, limit = 8) =>
  db
    .select({ ...seriesCardColumns, synopsis: series.synopsis, bannerKey: series.bannerKey })
    .from(series)
    .where(and(publishedSeries(), eq(series.isFeatured, true)))
    .orderBy(desc(series.lastChapterAt))
    .limit(limit)

/** Newest published series, for the "Recently added" rail. */
export const recentlyAdded = (db: Db, limit = 12) =>
  db
    .select(seriesCardColumns)
    .from(series)
    .where(publishedSeries())
    .orderBy(desc(series.publishedAt), desc(series.id))
    .limit(limit)

/** Recently completed series rail. */
export const recentlyCompleted = (db: Db, limit = 12) =>
  db
    .select(seriesCardColumns)
    .from(series)
    .where(and(publishedSeries(), eq(series.status, 'completed')))
    .orderBy(desc(series.lastChapterAt))
    .limit(limit)
