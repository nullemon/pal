import { DEFAULT_CHAPTER_LANGUAGE } from '@palscans/core/languages'
import { and, asc, count, desc, eq, gt, lt } from 'drizzle-orm'
import type { Db } from '../client.js'
import { chapterPages, chapters, series } from '../schema/index.js'
import { chapterRowColumns, publishedChapters, publishedSeries } from './_shared.js'

export type ChapterSort = 'desc' | 'asc'

export interface ChapterListOptions {
  /** Include unpublished states (staff). Default: published only. */
  includeUnpublished?: boolean
  limit?: number
  offset?: number
  /** Restrict to one translation. Absent means every language. */
  language?: string
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
  language: string
}

/** The chapter list on a series page (docs/06). Newest first by default. */
export const chapterList = (
  db: Db,
  seriesId: number,
  sort: ChapterSort = 'desc',
  opts: ChapterListOptions = {},
): Promise<ChapterListRow[]> => {
  // Absent means every language — the admin lists and the legacy callers. The reader always
  // passes one, because mixing translations into one numbered list is unreadable.
  const lang = opts.language ? eq(chapters.language, opts.language) : undefined
  const where = opts.includeUnpublished
    ? and(eq(chapters.seriesId, seriesId), lang)
    : and(eq(chapters.seriesId, seriesId), publishedChapters(), lang)
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
  /**
   * Which translation to read. Defaults to English, so every URL that existed before
   * migration 9044 resolves to exactly the chapter it always did.
   */
  language?: string
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
  // `(series, number)` stopped identifying one chapter when translations arrived; the language
  // is what makes the lookup single-valued again.
  const language = opts.language ?? DEFAULT_CHAPTER_LANGUAGE
  const [row] = await db
    .select({ chapter: chapters, series: series })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(
        eq(chapters.seriesId, seriesId),
        eq(chapters.number, number),
        eq(chapters.language, language),
        stateFilter,
        seriesFilter,
      ),
    )
    .limit(1)
  if (!row) return null

  // The language belongs here as much as in the lookup above: without it, Next from a German
  // chapter 12 lands on whichever chapter 13 exists — usually the English one — and the reader
  // is silently moved into another language mid-series.
  const neighbourFilter = (cmp: ReturnType<typeof gt>) =>
    and(eq(chapters.seriesId, seriesId), eq(chapters.language, language), cmp, stateFilter)

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

/**
 * Which languages a series actually has published chapters in, most chapters first.
 *
 * Drives the reader's language switcher, so it lists only translations that exist — a series
 * with two German chapters offers German, one with none does not, and nobody is sent to an
 * empty list. Ordering by count puts the main translation first, which is the one most readers
 * of that series want.
 */
export const seriesLanguages = async (
  db: Db,
  seriesId: number,
  opts: { includeUnpublished?: boolean } = {},
): Promise<Array<{ language: string; chapters: number }>> => {
  const rows = await db
    .select({ language: chapters.language, chapters: count(chapters.id) })
    .from(chapters)
    .where(
      opts.includeUnpublished
        ? eq(chapters.seriesId, seriesId)
        : and(eq(chapters.seriesId, seriesId), publishedChapters()),
    )
    .groupBy(chapters.language)
    .orderBy(desc(count(chapters.id)), chapters.language)
  return rows
}
