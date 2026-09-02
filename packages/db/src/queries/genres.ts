import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { genres, series, seriesGenres } from '../schema/index.js'

export interface GenreCount {
  id: number
  slug: string
  name: string
  kind: string
  count: number
}

/** Every genre/theme/format with its count of published series (zero included). */
export const genreCounts = async (db: Db, kind?: string): Promise<GenreCount[]> => {
  const count = sql<number>`count(${series.id})::int`
  const rows = await db
    .select({ id: genres.id, slug: genres.slug, name: genres.name, kind: genres.kind, count })
    .from(genres)
    .leftJoin(seriesGenres, eq(seriesGenres.genreId, genres.id))
    .leftJoin(
      series,
      and(
        eq(series.id, seriesGenres.seriesId),
        eq(series.state, 'published'),
        isNull(series.deletedAt),
      ),
    )
    .where(kind ? eq(genres.kind, kind) : undefined)
    .groupBy(genres.id)
    .orderBy(asc(genres.kind), asc(genres.name))
  return rows.map((r) => ({ ...r, count: Number(r.count) }))
}

export const genreBySlug = async (db: Db, slug: string) => {
  const [row] = await db.select().from(genres).where(eq(genres.slug, slug)).limit(1)
  return row ?? null
}
