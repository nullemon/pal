import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import {
  genres,
  people,
  series,
  seriesGenres,
  seriesPeople,
  seriesTitles,
} from '../schema/index.js'
import { publishedSeries, seriesCardColumns } from './_shared.js'

export type SeriesRow = typeof series.$inferSelect

export interface SeriesGenreRef {
  id: number
  slug: string
  name: string
  kind: string
}
export interface SeriesPersonRef {
  id: number
  slug: string
  name: string
  credit: string
}
export interface SeriesTitleRef {
  title: string
  lang: string | null
}

export interface SeriesDetail extends SeriesRow {
  genres: SeriesGenreRef[]
  people: SeriesPersonRef[]
  titles: SeriesTitleRef[]
  linked: { id: number; slug: string; title: string; type: SeriesRow['type'] } | null
}

export interface SeriesBySlugOptions {
  /** Include draft/unlisted/removed rows (staff). Default: published only. */
  includeUnpublished?: boolean
}

/** The series page: the row with genres, people (credits), alternative titles and counters. */
export const seriesBySlug = async (
  db: Db,
  slug: string,
  opts: SeriesBySlugOptions = {},
): Promise<SeriesDetail | null> => {
  const where = opts.includeUnpublished
    ? eq(series.slug, slug)
    : and(eq(series.slug, slug), publishedSeries())
  const [row] = await db.select().from(series).where(where).limit(1)
  if (!row) return null

  const [g, p, t, linked] = await Promise.all([
    db
      .select({ id: genres.id, slug: genres.slug, name: genres.name, kind: genres.kind })
      .from(seriesGenres)
      .innerJoin(genres, eq(genres.id, seriesGenres.genreId))
      .where(eq(seriesGenres.seriesId, row.id))
      .orderBy(genres.kind, genres.name),
    db
      .select({ id: people.id, slug: people.slug, name: people.name, credit: seriesPeople.credit })
      .from(seriesPeople)
      .innerJoin(people, eq(people.id, seriesPeople.personId))
      .where(eq(seriesPeople.seriesId, row.id))
      .orderBy(seriesPeople.credit, people.name),
    db
      .select({ title: seriesTitles.title, lang: seriesTitles.lang })
      .from(seriesTitles)
      .where(eq(seriesTitles.seriesId, row.id))
      .orderBy(seriesTitles.id),
    row.linkedSeriesId
      ? db
          .select({ id: series.id, slug: series.slug, title: series.title, type: series.type })
          .from(series)
          .where(and(eq(series.id, row.linkedSeriesId), publishedSeries()))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ])

  return { ...row, genres: g, people: p, titles: t, linked }
}

/** Rank of a series by all-time views among published series (1-based), for "Rank #2". */
export const seriesRank = async (db: Db, seriesId: number): Promise<number | null> => {
  const [row] = await db
    .select({
      rank: sql<number>`(select count(*)::int + 1 from ${series} s2 where s2.state = 'published' and s2.deleted_at is null and s2.view_count > ${series.viewCount})`,
    })
    .from(series)
    .where(eq(series.id, seriesId))
    .limit(1)
  return row ? Number(row.rank) : null
}

/** Recommended: published series sharing the most genres, then by popularity. */
export const recommendedSeries = async (db: Db, seriesId: number, limit = 6) => {
  const genreIds = (
    await db
      .select({ id: seriesGenres.genreId })
      .from(seriesGenres)
      .where(eq(seriesGenres.seriesId, seriesId))
  ).map((r) => r.id)
  if (genreIds.length === 0) {
    return db
      .select(seriesCardColumns)
      .from(series)
      .where(and(publishedSeries(), ne(series.id, seriesId)))
      .orderBy(desc(series.viewCount))
      .limit(limit)
  }
  const shared = sql<number>`count(${seriesGenres.genreId})::int`
  return db
    .select({ ...seriesCardColumns, shared })
    .from(seriesGenres)
    .innerJoin(series, eq(series.id, seriesGenres.seriesId))
    .where(and(inArray(seriesGenres.genreId, genreIds), ne(series.id, seriesId), publishedSeries()))
    .groupBy(series.id)
    .orderBy(desc(shared), desc(series.viewCount))
    .limit(limit)
}
