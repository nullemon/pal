import { and, eq, isNull, sql } from 'drizzle-orm'
import { chapters, series } from '../schema/index.js'

/**
 * Escape the ILIKE metacharacters in user input so `%` / `_` match literally; pair with
 * `escape '\\'` in the pattern (a bare `?q=%` must not match every row).
 */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&')

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

/**
 * The page a listing actually serves, given how many rows there are: never below 1, never
 * past the last page that holds any. `clampPage` only ever knew the lower bound, which is
 * how `?page=9999` became a real query — `OFFSET 239976`, a full sort, no rows — and, worse
 * than the query, a cache entry of its own for every one of the ten thousand values the
 * parameter accepts. Clamping first makes every out-of-range page the last real page: one
 * answer, one cache key. `/browse` has always done this inline; this is that rule, in one
 * place, for every listing that paginates.
 */
export const pageWindow = (
  page: number | undefined,
  total: number,
  pageSize: number,
): { page: number; totalPages: number } => {
  const size = Math.max(1, Math.floor(pageSize))
  const totalPages = Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / size))
  const asked = Math.floor(Number(page) || 1)
  return { page: Math.min(Math.max(1, asked), totalPages), totalPages }
}

export const count = () => sql<number>`count(*)::int`
