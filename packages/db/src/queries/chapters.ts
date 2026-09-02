import { and, asc, desc, eq, gt, lt } from 'drizzle-orm'
import type { Db } from '../client.js'
import { chapterPages, chapters, series } from '../schema/index.js'
import { chapterRowColumns, publishedChapters, publishedSeries } from './_shared.js'

export type ChapterSort = 'desc' | 'asc'

export interface ChapterListOptions {
  /** Include unpublished states (staff). Default: published only. */
  includeUnpublished?: boolean
  limit?: number
  offset?: number
}

export type ChapterListRow = {
  id: number
  seriesId: number
  number: number
  volume: number | null
  title: string | null
  state: (typeof chapters.$inferSelect)['state']
  isPremium: boolean
  earlyAccessUntil: Date | null
  publishedAt: Date | null
  pageCount: number
  viewCount: number
}

/** The chapter list on a series page (docs/06). Newest first by default. */
export const chapterList = (
  db: Db,
  seriesId: number,
  sort: ChapterSort = 'desc',
  opts: ChapterListOptions = {},
): Promise<ChapterListRow[]> => {
  const where = opts.includeUnpublished
    ? eq(chapters.seriesId, seriesId)
    : and(eq(chapters.seriesId, seriesId), publishedChapters())
  const q = db
    .select(chapterRowColumns)
    .from(chapters)
    .where(where)
    .orderBy(sort === 'asc' ? asc(chapters.number) : desc(chapters.number))
  const limited = opts.limit ? q.limit(opts.limit) : q
  return opts.offset ? limited.offset(opts.offset) : limited
}

export type ChapterPageRow = typeof chapterPages.$inferSelect

export interface ChapterWithPages {
  chapter: typeof chapters.$inferSelect
  series: {
    id: number
    slug: string
    title: string
    type: (typeof series.$inferSelect)['type']
    readingDirection: (typeof series.$inferSelect)['readingDirection']
    commentsEnabled: boolean
    coverKey: string | null
  }
  pages: ChapterPageRow[]
  prev: { id: number; number: number } | null
  next: { id: number; number: number } | null
}

export interface ChapterWithPagesOptions {
  includeUnpublished?: boolean
}

/**
 * The reader's chapter: row, its series, ordered pages and prev/next numbers.
 * Callers MUST gate `pages` behind `canReadChapter` before rendering URLs for locked
 * chapters (docs/16 conventions).
 */
export const chapterWithPages = async (
  db: Db,
  seriesId: number,
  number: number,
  opts: ChapterWithPagesOptions = {},
): Promise<ChapterWithPages | null> => {
  const stateFilter = opts.includeUnpublished ? undefined : publishedChapters()
  const seriesFilter = opts.includeUnpublished ? undefined : publishedSeries()
  const [row] = await db
    .select({ chapter: chapters, series: series })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(eq(chapters.seriesId, seriesId), eq(chapters.number, number), stateFilter, seriesFilter),
    )
    .limit(1)
  if (!row) return null

  const neighbourFilter = (cmp: ReturnType<typeof gt>) =>
    and(eq(chapters.seriesId, seriesId), cmp, stateFilter)

  const [pages, [prev], [next]] = await Promise.all([
    db
      .select()
      .from(chapterPages)
      .where(eq(chapterPages.chapterId, row.chapter.id))
      .orderBy(asc(chapterPages.idx)),
    db
      .select({ id: chapters.id, number: chapters.number })
      .from(chapters)
      .where(neighbourFilter(lt(chapters.number, number)))
      .orderBy(desc(chapters.number))
      .limit(1),
    db
      .select({ id: chapters.id, number: chapters.number })
      .from(chapters)
      .where(neighbourFilter(gt(chapters.number, number)))
      .orderBy(asc(chapters.number))
      .limit(1),
  ])

  return {
    chapter: row.chapter,
    series: {
      id: row.series.id,
      slug: row.series.slug,
      title: row.series.title,
      type: row.series.type,
      readingDirection: row.series.readingDirection,
      commentsEnabled: row.series.commentsEnabled,
      coverKey: row.series.coverKey,
    },
    pages,
    prev: prev ?? null,
    next: next ?? null,
  }
}

/** Newest published chapters site-wide (the /feed and the "latest" strip). */
export const latestChapters = (db: Db, limit = 50) =>
  db
    .select({
      ...chapterRowColumns,
      seriesSlug: series.slug,
      seriesTitle: series.title,
      seriesType: series.type,
      coverKey: series.coverKey,
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(publishedChapters(), publishedSeries()))
    .orderBy(desc(chapters.publishedAt), desc(chapters.id))
    .limit(limit)
