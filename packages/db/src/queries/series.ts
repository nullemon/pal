import { BAYESIAN_C } from '@palscans/core'
import { and, desc, eq, inArray, isNull, ne, not, sql } from 'drizzle-orm'
import { type Db, executeRows } from '../client.js'
import {
  bookmarks,
  genres,
  people,
  readingProgress,
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
      // A retired genre keeps its `series_genres` rows (migration 9028) so a restore brings
      // them back — but its page is gone, so its chip must not be rendered as a live link.
      .where(and(eq(seriesGenres.seriesId, row.id), isNull(genres.deletedAt)))
      .orderBy(genres.kind, genres.position, genres.name),
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

/**
 * Rank of a series by all-time views among published series (1-based), for "Rank #2".
 *
 * The outer column has to be written out (`"series".view_count`) rather than interpolated
 * as `${series.viewCount}`: Drizzle renders a column reference inside a raw `sql` fragment
 * unqualified, which inside this subquery bound to `s2.view_count` — the comparison was
 * `s2.view_count > s2.view_count`, always false, and every series ranked #1.
 */
export const seriesRank = async (db: Db, seriesId: number): Promise<number | null> => {
  const [row] = await db
    .select({
      rank: sql<number>`(select count(*)::int + 1 from ${series} s2 where s2.state = 'published' and s2.deleted_at is null and s2.view_count > ${series}.view_count)`,
    })
    .from(series)
    .where(eq(series.id, seriesId))
    .limit(1)
  return row ? Number(row.rank) : null
}

export interface RecommendedOptions {
  limit?: number
  /**
   * Drop everything this reader has already opened (they have a `reading_progress` row for
   * it). Recommending a series they finished last week is worse than recommending nothing —
   * it is the one suggestion that proves the site was not paying attention.
   */
  excludeReadBy?: number | null
  /** Drop what they have already bookmarked: they have found it, it is not a discovery. */
  excludeBookmarkedBy?: number | null
  /**
   * Prior for the Bayesian rating, so a single 10/10 does not outrank a 9.2 with 4,000
   * votes. Pass the site mean when the caller has it; 7.5 is `siteMean`'s own fallback.
   */
  ratingPrior?: number
  /**
   * When the genre-matched list comes back empty — a reader who has read everything in the
   * genre — fall back to popular unread series instead of showing nothing. Off by default so
   * the series page keeps its strictly on-genre rail.
   */
  fallbackToPopular?: boolean
}

/** Bayesian rating in SQL: `(sum + C·prior) / (count + C)`, the same shape browse sorts by. */
const bayesRating = (prior: number) =>
  sql<number>`((${series.ratingSum} + ${BAYESIAN_C} * ${prior}::float8) / (${series.ratingCount} + ${BAYESIAN_C})::float8)`

/** `series` this reader has already opened / already bookmarked. */
const alreadyRead = (userId: number) =>
  sql`exists (select 1 from ${readingProgress} where ${readingProgress.userId} = ${userId} and ${readingProgress.seriesId} = ${series.id})`

const alreadyBookmarked = (userId: number) =>
  sql`exists (select 1 from ${bookmarks} where ${bookmarks.userId} = ${userId} and ${bookmarks.seriesId} = ${series.id})`

const seenFilters = (opts: RecommendedOptions) => [
  ...(opts.excludeReadBy ? [not(alreadyRead(opts.excludeReadBy))] : []),
  ...(opts.excludeBookmarkedBy ? [not(alreadyBookmarked(opts.excludeBookmarkedBy))] : []),
]

/**
 * Recommended: published series sharing the most genres, best-rated first, minus anything
 * this reader has already read or bookmarked.
 *
 * The third argument still takes a bare `limit` so the series page's `recommendedSeries(db,
 * id, 6)` keeps working; pass an options object for the personalised form.
 */
export const recommendedSeries = async (
  db: Db,
  seriesId: number,
  limitOrOptions: number | RecommendedOptions = 6,
) => {
  const opts: RecommendedOptions =
    typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : limitOrOptions
  const limit = opts.limit ?? 6
  const prior = opts.ratingPrior ?? 7.5
  const rating = bayesRating(prior)
  const unseen = seenFilters(opts)

  const popular = () =>
    db
      .select(seriesCardColumns)
      .from(series)
      .where(and(publishedSeries(), ne(series.id, seriesId), ...unseen))
      .orderBy(desc(series.viewCount), desc(series.id))
      .limit(limit)

  const genreIds = (
    await db
      .select({ id: seriesGenres.genreId })
      .from(seriesGenres)
      .where(eq(seriesGenres.seriesId, seriesId))
  ).map((r) => r.id)
  if (genreIds.length === 0) return popular()

  const shared = sql<number>`count(distinct ${seriesGenres.genreId})::int`
  const rows = await db
    .select({ ...seriesCardColumns, shared })
    .from(seriesGenres)
    .innerJoin(series, eq(series.id, seriesGenres.seriesId))
    .where(
      and(
        inArray(seriesGenres.genreId, genreIds),
        ne(series.id, seriesId),
        publishedSeries(),
        ...unseen,
      ),
    )
    .groupBy(series.id)
    // Overlap first (that is the actual signal), then quality, then reach as the tiebreak.
    .orderBy(desc(shared), desc(rating), desc(series.viewCount), desc(series.id))
    .limit(limit)

  if (rows.length === 0 && opts.fallbackToPopular) return popular()
  return rows
}

/**
 * How many ids `randomPublishedSeries` throws at the table before it gives up on landing on
 * a published one. Twelve is far more than a healthy catalogue needs — with 90% of rows
 * published the first probe lands 90% of the time — and it is the *unhealthy* catalogue the
 * number is for: an install where most series are drafts still lands one 12 times out of
 * every 12.4 attempts before the fallback below has to answer.
 */
export const RANDOM_SERIES_PROBES = 12

/**
 * `/random` — one published series, uniformly (docs/13 "Random series").
 *
 * `ORDER BY random() LIMIT 1` is the obvious spelling and the reason the route was a
 * sequential scan: it computes `random()` for every published row and sorts them, so the
 * cost of one redirect grows with the catalogue (measured on a 50k seed: Seq Scan over
 * 46,000 rows, 1,989 buffers, 34.8 ms — on a route that is `force-dynamic`, `no-store` and
 * linked from the site header).
 *
 * Instead: pick ids at random out of the published id range and take the first one that is a
 * published row. Each probe is a primary-key lookup, so the work is bounded by
 * `RANDOM_SERIES_PROBES` rather than by the size of the table — 45 buffers, 0.34 ms on the
 * same seed, and flat as the catalogue grows.
 *
 * On uniformity, which is the whole point of the route: conditioned on a probe landing on a
 * published row, that row is uniform over published series — every id in the range is equally
 * likely and each published id belongs to exactly one series. Gaps (drafts, soft-deleted
 * rows, removed series) cost attempts, never fairness. The `nearest` fallback is the one
 * biased branch — it walks back to the first published row at or below the probe, so a series
 * behind a long gap is likelier — and it only answers when all twelve probes missed, which on
 * a catalogue that is nine-tenths published happens once in 10^12 requests. It exists so the
 * route always redirects somewhere rather than 307ing to `/browse` on a bad roll.
 */
export const randomPublishedSeries = async (db: Db): Promise<string | null> => {
  const rows = await executeRows<{ slug: string }>(
    db,
    sql`
      with bounds as (
        select min(id) as lo, max(id) as hi from series
        where state = 'published' and deleted_at is null
      ),
      probes as (
        select bounds.lo + floor(random() * (bounds.hi - bounds.lo + 1))::bigint as id, g.n as n
        from bounds, generate_series(1, ${RANDOM_SERIES_PROBES}) as g(n)
        where bounds.lo is not null
      ),
      hit as (
        select series.slug as slug, probes.n as n
        from probes join series on series.id = probes.id
        where series.state = 'published' and series.deleted_at is null
        order by probes.n
        limit 1
      ),
      nearest as (
        select series.slug as slug from series, probes
        where probes.n = 1 and series.id <= probes.id
          and series.state = 'published' and series.deleted_at is null
        order by series.id desc
        limit 1
      )
      select slug from hit
      union all
      select slug from nearest where not exists (select 1 from hit)
      limit 1
    `,
  )
  return rows[0]?.slug ?? null
}
