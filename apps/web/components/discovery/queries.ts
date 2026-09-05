import {
  formatChapterNumber,
  isPopularityWindow,
  type PopularityWindow,
  siteMean,
} from '@palscans/core'
import {
  announcements,
  chapters,
  featuredSeries,
  genreBySlug,
  genreCounts,
  genres,
  getDb,
  popular,
  readingProgress,
  recentlyAdded,
  searchSeries,
  series,
  seriesGenres,
  seriesStatsDaily,
} from '@palscans/db'
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  not,
  type SQL,
  sql,
} from 'drizzle-orm'
import { ensureConfig } from '@/lib/config/install'
import type { BrowseParams, BrowseSort } from './filters'
import { BROWSE_PAGE_SIZE } from './filters'
import { coverSrc } from './media'
import type {
  AnnouncementSummary,
  ChapterSummary,
  ContinueItem,
  GenreSummary,
  HeroSlide,
  PagedResult,
  RankedSeries,
  SeriesSummary,
  UpdateItem,
} from './types'

/**
 * Discovery queries. Only server code imports this module (it touches the database and the
 * environment). Results are plain, serialisable view models — see ./types.ts.
 */

const published = () => and(eq(series.state, 'published'), isNull(series.deletedAt))

const cardColumns = {
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

interface CardRow {
  id: number
  slug: string
  title: string
  type: SeriesSummary['type']
  status: SeriesSummary['status']
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

export const seriesHref = (slug: string) => `/series/${slug}`
export const chapterHref = (slug: string, number: number) =>
  `/series/${slug}/chapter-${formatChapterNumber(number)}`

const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : d instanceof Date ? d.toISOString() : d

export const toSummary = (r: CardRow): SeriesSummary => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  type: r.type,
  status: r.status,
  coverSrc: coverSrc(r.coverKey, r.coverColor),
  coverColor: r.coverColor,
  rating: Number(r.ratingAvg ?? 0),
  ratingCount: r.ratingCount,
  chapterCount: r.chapterCount,
  bookmarkCount: r.bookmarkCount,
  viewCount: Number(r.viewCount),
  lastChapterAt: iso(r.lastChapterAt),
  isPinned: r.isPinned,
  isFeatured: r.isFeatured,
  mature: r.ageRating === 'mature',
  href: seriesHref(r.slug),
})

/**
 * The N most recent published chapters per series, ranked in SQL so a 400-chapter series
 * contributes N rows, not 400. Returns a map keyed by series id, newest first.
 */
export async function latestChaptersFor(
  ids: number[],
  slugs: Map<number, string>,
  perSeries = 1,
): Promise<Map<number, ChapterSummary[]>> {
  await ensureConfig()
  const out = new Map<number, ChapterSummary[]>()
  if (ids.length === 0) return out
  const db = await getDb()
  const ranked = db.$with('ranked').as(
    db
      .select({
        id: chapters.id,
        seriesId: chapters.seriesId,
        number: chapters.number,
        title: chapters.title,
        isPremium: chapters.isPremium,
        earlyAccessUntil: chapters.earlyAccessUntil,
        publishedAt: chapters.publishedAt,
        rn: sql<number>`row_number() over (partition by ${chapters.seriesId} order by ${chapters.number} desc)`.as(
          'rn',
        ),
      })
      .from(chapters)
      .where(
        and(
          inArray(chapters.seriesId, ids),
          eq(chapters.state, 'published'),
          isNull(chapters.deletedAt),
        ),
      ),
  )
  const rows = await db
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
  for (const c of rows) {
    const slug = slugs.get(c.seriesId)
    if (!slug) continue
    const list = out.get(c.seriesId) ?? []
    list.push({
      id: c.id,
      number: Number(c.number),
      title: c.title,
      isPremium: c.isPremium,
      earlyAccessUntil: iso(c.earlyAccessUntil),
      publishedAt: iso(c.publishedAt),
      href: chapterHref(slug, Number(c.number)),
    })
    out.set(c.seriesId, list)
  }
  return out
}

const slugMap = (rows: readonly { id: number; slug: string }[]) =>
  new Map(rows.map((r) => [r.id, r.slug] as const))

// --- home -------------------------------------------------------------------------------

/** Hero carousel: `series.is_featured`, newest update first. */
export async function heroSlides(limit: number): Promise<HeroSlide[]> {
  await ensureConfig()
  const db = await getDb()
  const rows = await featuredSeries(db, limit)
  const latest = await latestChaptersFor(
    rows.map((r) => r.id),
    slugMap(rows),
  )
  return rows.map((r) => ({
    ...toSummary(r),
    synopsis: r.synopsis,
    latest: latest.get(r.id)?.[0] ?? null,
  }))
}

/** Popular in a window with each series' latest chapter; falls back to all-time when the
 * window has no view stats yet (a fresh install). */
export async function rankedSeries(
  window: PopularityWindow,
  limit: number,
): Promise<RankedSeries[]> {
  await ensureConfig()
  const db = await getDb()
  let rows = await popular(db, window, { limit })
  if (rows.length === 0 && window !== 'all') rows = await popular(db, 'all', { limit })
  const latest = await latestChaptersFor(
    rows.map((r) => r.id),
    slugMap(rows),
  )
  return rows.map((r) => ({
    ...toSummary(r),
    rank: r.rank,
    views: r.views,
    latest: latest.get(r.id)?.[0] ?? null,
  }))
}

export async function popularLists(
  limit: number,
): Promise<Record<PopularityWindow, RankedSeries[]>> {
  await ensureConfig()
  const [weekly, monthly, all] = await Promise.all([
    rankedSeries('weekly', limit),
    rankedSeries('monthly', limit),
    rankedSeries('all', limit),
  ])
  return { weekly, monthly, all }
}

export const parseWindow = (v: unknown): PopularityWindow | null =>
  isPopularityWindow(v) ? v : null

export interface LatestUpdatesOptions {
  page: number
  pageSize: number
  type?: SeriesSummary['type']
  chaptersPerSeries?: number
}

/**
 * Latest updates: pinned first, then by last chapter time, with the three newest chapters
 * per row. Same shape as `homeFeed` in @palscans/db plus the type tab filter.
 */
export async function latestUpdates(opts: LatestUpdatesOptions): Promise<PagedResult<UpdateItem>> {
  await ensureConfig()
  const db = await getDb()
  const pageSize = Math.min(60, Math.max(1, opts.pageSize))
  const where = and(
    published(),
    isNotNull(series.lastChapterAt),
    opts.type ? eq(series.type, opts.type) : undefined,
  )
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(series)
    .where(where)
  const totalPages = Math.max(1, Math.ceil(Number(total) / pageSize))
  const page = Math.min(Math.max(1, opts.page), totalPages)
  const rows = await db
    .select(cardColumns)
    .from(series)
    .where(where)
    .orderBy(desc(series.isPinned), desc(series.lastChapterAt), desc(series.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  const latest = await latestChaptersFor(
    rows.map((r) => r.id),
    slugMap(rows),
    opts.chaptersPerSeries ?? 3,
  )
  return {
    items: rows.map((r) => ({ ...toSummary(r), chapters: latest.get(r.id) ?? [] })),
    page,
    pageSize,
    total: Number(total),
    totalPages,
  }
}

export async function newestSeries(limit: number): Promise<SeriesSummary[]> {
  await ensureConfig()
  const db = await getDb()
  const rows = await recentlyAdded(db, limit)
  return rows.map(toSummary)
}

/** The signed-in reader's most recently touched series, with the chapter they stopped in. */
export async function continueReading(userId: number, limit: number): Promise<ContinueItem[]> {
  await ensureConfig()
  const db = await getDb()
  const rows = await db
    .select({
      ...cardColumns,
      chapterId: chapters.id,
      chapterNumber: chapters.number,
      chapterTitle: chapters.title,
      chapterPremium: chapters.isPremium,
      chapterEarlyAccess: chapters.earlyAccessUntil,
      chapterPublishedAt: chapters.publishedAt,
      readAt: readingProgress.readAt,
    })
    .from(readingProgress)
    .innerJoin(series, eq(series.id, readingProgress.seriesId))
    .innerJoin(chapters, eq(chapters.id, readingProgress.chapterId))
    .where(and(eq(readingProgress.userId, userId), published()))
    .orderBy(desc(readingProgress.readAt))
    .limit(Math.min(24, Math.max(1, limit)))
  return rows.map((r) => ({
    ...toSummary(r),
    chapter: {
      id: r.chapterId,
      number: Number(r.chapterNumber),
      title: r.chapterTitle,
      isPremium: r.chapterPremium,
      earlyAccessUntil: iso(r.chapterEarlyAccess),
      publishedAt: iso(r.chapterPublishedAt),
      href: chapterHref(r.slug, Number(r.chapterNumber)),
    },
    readAt: r.readAt.toISOString(),
  }))
}

export async function latestAnnouncement(): Promise<AnnouncementSummary | null> {
  await ensureConfig()
  const db = await getDb()
  const [row] = await db
    .select({
      slug: announcements.slug,
      title: announcements.title,
      excerpt: announcements.excerpt,
      publishedAt: announcements.publishedAt,
    })
    .from(announcements)
    .where(and(eq(announcements.state, 'published'), lte(announcements.publishedAt, new Date())))
    .orderBy(desc(announcements.publishedAt), desc(announcements.id))
    .limit(1)
  if (!row) return null
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    publishedAt: iso(row.publishedAt),
    href: `/announcements/${row.slug}`,
  }
}

// --- browse / genres --------------------------------------------------------------------

export interface BrowseQuery {
  type?: BrowseParams['type']
  status?: BrowseParams['status']
  includeGenreIds: number[]
  excludeGenreIds: number[]
  minChapters: number
  minRating: number
  sort: BrowseSort
  page: number
  pageSize?: number
}

type Database = Awaited<ReturnType<typeof getDb>>

/** `EXISTS (…)` — the series carries this genre. Include filters AND these together. */
const inGenre = (db: Database, genreId: number) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(seriesGenres)
      .where(and(eq(seriesGenres.seriesId, series.id), eq(seriesGenres.genreId, genreId))),
  )

/** `EXISTS (…)` — the series carries any of these genres; negated for the exclude filter. */
const inAnyGenre = (db: Database, genreIds: number[]) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(seriesGenres)
      .where(and(eq(seriesGenres.seriesId, series.id), inArray(seriesGenres.genreId, genreIds))),
  )

async function ratingMean(): Promise<number> {
  const db = await getDb()
  const [row] = await db
    .select({
      sum: sql<number>`coalesce(sum(${series.ratingSum}), 0)::float`,
      count: sql<number>`coalesce(sum(${series.ratingCount}), 0)::float`,
    })
    .from(series)
    .where(published())
  return siteMean(Number(row?.sum ?? 0), Number(row?.count ?? 0))
}

function orderFor(sort: BrowseSort, mean: number): SQL[] {
  switch (sort) {
    case 'popular':
      return [desc(series.viewCount), desc(series.id)]
    case 'rating':
      return [
        desc(
          sql`(${series.ratingSum} + 20 * ${mean}::float8) / (${series.ratingCount} + 20)::float8`,
        ),
        desc(series.ratingCount),
        desc(series.id),
      ]
    case 'newest':
      return [sql`${series.publishedAt} desc nulls last`, desc(series.id)]
    case 'title':
      return [asc(series.title), asc(series.id)]
    default:
      return [sql`${series.lastChapterAt} desc nulls last`, desc(series.id)]
  }
}

/** The browse grid: filters (include AND exclude genres), sort, real pagination. */
export async function browseSeries(q: BrowseQuery): Promise<PagedResult<SeriesSummary>> {
  await ensureConfig()
  const db = await getDb()
  const pageSize = Math.min(60, Math.max(1, q.pageSize ?? BROWSE_PAGE_SIZE))
  const conditions: (SQL | undefined)[] = [
    published(),
    q.type ? eq(series.type, q.type) : undefined,
    q.status ? eq(series.status, q.status) : undefined,
    q.minChapters > 0 ? gte(series.chapterCount, q.minChapters) : undefined,
    q.minRating > 0
      ? and(gt(series.ratingCount, 0), gte(series.ratingAvg, q.minRating))
      : undefined,
    ...q.includeGenreIds.map((id) => inGenre(db, id)),
    q.excludeGenreIds.length ? not(inAnyGenre(db, q.excludeGenreIds)) : undefined,
  ]
  const where = and(...conditions)
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(series)
    .where(where)
  const totalPages = Math.max(1, Math.ceil(Number(total) / pageSize))
  const page = Math.min(Math.max(1, q.page), totalPages)
  const mean = q.sort === 'rating' ? await ratingMean() : 0
  const rows = await db
    .select(cardColumns)
    .from(series)
    .where(where)
    .orderBy(...orderFor(q.sort, mean))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  return { items: rows.map(toSummary), page, pageSize, total: Number(total), totalPages }
}

/** Resolve genre slugs to ids; unknown and retired slugs are dropped. */
export async function genreIdsFor(
  slugs: string[],
): Promise<{ id: number; slug: string; name: string }[]> {
  if (slugs.length === 0) return []
  const db = await getDb()
  return db
    .select({ id: genres.id, slug: genres.slug, name: genres.name })
    .from(genres)
    .where(and(inArray(genres.slug, slugs), isNull(genres.deletedAt)))
}

export async function allGenres(): Promise<GenreSummary[]> {
  await ensureConfig()
  const db = await getDb()
  const rows = await genreCounts(db)
  return rows.map((g) => ({ ...g, href: `/genres/${g.slug}` }))
}

export async function genreDetail(slug: string) {
  await ensureConfig()
  const db = await getDb()
  const row = await genreBySlug(db, slug)
  if (!row) return null
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(seriesGenres)
    .innerJoin(series, eq(series.id, seriesGenres.seriesId))
    .where(and(eq(seriesGenres.genreId, row.id), published()))
  return { ...row, count: Number(count), href: `/genres/${row.slug}` }
}

/** Latest chapter for a page of cards (the "Ch. N" pill on `SeriesCard`). */
export async function withLatest<T extends SeriesSummary>(
  items: T[],
): Promise<(T & { latest: ChapterSummary | null })[]> {
  const latest = await latestChaptersFor(
    items.map((s) => s.id),
    new Map(items.map((s) => [s.id, s.slug])),
  )
  return items.map((s) => ({ ...s, latest: latest.get(s.id)?.[0] ?? null }))
}

// --- search / random --------------------------------------------------------------------

export interface SearchHit extends SeriesSummary {
  score: number
  matchedTitle: string | null
}

export async function search(q: string, limit = 40): Promise<SearchHit[]> {
  await ensureConfig()
  const db = await getDb()
  const rows = await searchSeries(db, q, { limit })
  return rows.map((r) => ({ ...toSummary(r), score: r.score, matchedTitle: r.matchedTitle }))
}

export async function randomSeriesSlug(): Promise<string | null> {
  await ensureConfig()
  const db = await getDb()
  const [row] = await db
    .select({ slug: series.slug })
    .from(series)
    .where(published())
    .orderBy(sql`random()`)
    .limit(1)
  return row?.slug ?? null
}

/** True when the popularity windows have any rollup rows (used to label rankings). */
export async function hasViewStats(): Promise<boolean> {
  await ensureConfig()
  const db = await getDb()
  const [row] = await db.select({ one: sql<number>`1` }).from(seriesStatsDaily).limit(1)
  return !!row
}
