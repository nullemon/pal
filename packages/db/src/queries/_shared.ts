import { and, eq, isNull, sql } from 'drizzle-orm'
import { chapters, series } from '../schema/index.js'

/** Published, not soft-deleted series. */
export const publishedSeries = () => and(eq(series.state, 'published'), isNull(series.deletedAt))

/** Published, not soft-deleted chapters. */
export const publishedChapters = () =>
  and(eq(chapters.state, 'published'), isNull(chapters.deletedAt))

export const seriesCardColumns = {
  id: series.id,
  slug: series.slug,
  title: series.title,
  type: series.type,
  status: series.status,
  coverKey: series.coverKey,
  coverColor: series.coverColor,
  ratingAvg: series.ratingAvg,
  ratingCount: series.ratingCount,
  chapterCount: series.chapterCount,
  bookmarkCount: series.bookmarkCount,
  viewCount: series.viewCount,
  lastChapterAt: series.lastChapterAt,
  isPinned: series.isPinned,
  isFeatured: series.isFeatured,
  ageRating: series.ageRating,
} as const

export const chapterRowColumns = {
  id: chapters.id,
  seriesId: chapters.seriesId,
  number: chapters.number,
  volume: chapters.volume,
  title: chapters.title,
  state: chapters.state,
  isPremium: chapters.isPremium,
  earlyAccessUntil: chapters.earlyAccessUntil,
  publishedAt: chapters.publishedAt,
  pageCount: chapters.pageCount,
  viewCount: chapters.viewCount,
} as const

export const clampPage = (page: number | undefined, pageSize: number | undefined, max = 100) => ({
  page: Math.max(1, Math.floor(page ?? 1)),
  pageSize: Math.min(max, Math.max(1, Math.floor(pageSize ?? 20))),
})

export const count = () => sql<number>`count(*)::int`
