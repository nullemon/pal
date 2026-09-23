import { createHash } from 'node:crypto'
import { slugify } from '@palscans/core'
import type { SeriesMetadata } from '@palscans/core/metadata'
import { getQueue } from '@palscans/core/queue'
import {
  genres,
  getDb,
  people,
  type SeriesArtPending,
  series,
  seriesGenres,
  seriesPeople,
  seriesTitles,
} from '@palscans/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { fetchCover } from '@/lib/metadata/anilist'
import { getStorage } from '@/lib/storage'

/**
 * Turning an AniList candidate into a series row (Admin → Series → Look up, and the bulk
 * screen behind it).
 *
 * The rules this file exists to hold:
 *
 * - **Nothing is published.** Every imported series lands as a `draft`. Third-party metadata
 *   is a starting point for the operator, not a decision, and a wrong match that went live
 *   would be visible to readers before anyone noticed.
 * - **Genres are matched, never created.** AniList has its own taxonomy; letting it invent
 *   genres here would fill this site's genre list with entries nobody chose. Unmatched names
 *   come back in the response so the operator can add the ones they actually want.
 * - **People are created on the fly**, exactly as the series editor already does for a name
 *   typed by hand — the alternative is an import that silently drops the author.
 * - **The cover goes through `series.art`** like an uploaded one: the original lands under
 *   `uploads/art/`, and `coverKey` only changes when the worker has re-encoded it. Nothing
 *   ever points a reader at anilist.co.
 *
 * What is deliberately *not* stored is where a series came from. There is no column for it,
 * and `canonicalUrl` is not that column — it is the SEO canonical, and pointing it at AniList
 * would tell search engines AniList owns this page. A `source_id` column would let a later
 * re-sync know what it matched; until one exists the match is a one-time fill.
 */

/** A slug that is free, derived from the title, with a numeric suffix only if it has to be. */
export const uniqueSeriesSlug = async (title: string): Promise<string> => {
  const db = await getDb()
  const base = slugify(title) || 'series'
  const [taken] = await db
    .select({ slug: series.slug })
    .from(series)
    .where(eq(series.slug, base))
    .limit(1)
  if (!taken) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`
    const [clash] = await db
      .select({ slug: series.slug })
      .from(series)
      .where(eq(series.slug, candidate))
      .limit(1)
    if (!clash) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

export interface GenreMatch {
  ids: number[]
  unmatched: string[]
}

/**
 * AniList genre names against this site's genres, by slug.
 *
 * Slug rather than name so "Sci-Fi" and "Sci Fi" land on the same row, and deleted genres are
 * excluded — a retired genre must not come back through the importer's side door.
 */
export const matchGenres = async (names: readonly string[]): Promise<GenreMatch> => {
  if (names.length === 0) return { ids: [], unmatched: [] }
  const db = await getDb()
  const wanted = new Map(names.map((n) => [slugify(n), n]))
  const rows = await db
    .select({ id: genres.id, slug: genres.slug })
    .from(genres)
    .where(and(inArray(genres.slug, [...wanted.keys()]), isNull(genres.deletedAt)))
  const ids = rows.map((r) => r.id)
  const found = new Set(rows.map((r) => String(r.slug).toLowerCase()))
  const unmatched = [...wanted.entries()]
    .filter(([slug]) => !found.has(slug))
    .map(([, name]) => name)
  return { ids, unmatched }
}

/** Find a person by the slug of their name, or create them. Mirrors the series editor. */
const personId = async (name: string): Promise<number | null> => {
  const db = await getDb()
  const slug = slugify(name)
  if (!slug) return null
  const [existing] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.slug, slug))
    .limit(1)
  if (existing) return existing.id
  const [created] = await db.insert(people).values({ name, slug }).returning({ id: people.id })
  return created?.id ?? null
}

/**
 * Download the candidate's cover and hand it to `series.art`.
 *
 * Best-effort on purpose: a series with everything but its cover is worth keeping, and the
 * operator can upload one by hand. Returning false rather than throwing keeps a dead image
 * host from failing an otherwise good import.
 */
export const attachCover = async (
  seriesId: number,
  coverUrl: string,
  requestedBy: number,
): Promise<boolean> => {
  const fetched = await fetchCover(coverUrl)
  if (!fetched) return false
  const sha = createHash('sha256').update(fetched.body).digest('hex')
  const key = `uploads/art/${seriesId}/${sha.slice(0, 12)}.${fetched.ext}`
  const storage = await getStorage()
  await storage.put(key, fetched.body, { contentType: fetched.contentType })
  const db = await getDb()
  const [row] = await db
    .select({ artPending: series.artPending })
    .from(series)
    .where(eq(series.id, seriesId))
    .limit(1)
  const pending: SeriesArtPending = {
    ...(row?.artPending ?? {}),
    cover: { key, requestedAt: new Date().toISOString(), requestedBy },
  }
  await db
    .update(series)
    .set({ artPending: pending, updatedAt: new Date() })
    .where(eq(series.id, seriesId))
  try {
    const queue = await getQueue()
    await queue.add(
      'series.art',
      { seriesId, kind: 'cover', key },
      { jobId: `series.art:${seriesId}:cover:${key.slice(-16)}`, attempts: 3 },
    )
  } catch {
    // No queue reachable: the worker's scheduler pass finds the pending entry on its own.
  }
  return true
}

export interface ImportOutcome {
  seriesId: number
  slug: string
  title: string
  coverQueued: boolean
  unmatchedGenres: string[]
}

/**
 * Create one draft series from a candidate.
 *
 * The whole row goes in one transaction so a failure half way leaves nothing behind; the
 * cover is fetched *after* it commits, because it reaches the network and must not hold a
 * database transaction open while it does.
 */
export const createSeriesFromMetadata = async (
  meta: SeriesMetadata,
  actorId: number,
): Promise<ImportOutcome> => {
  const db = await getDb()
  const slug = await uniqueSeriesSlug(meta.title)
  const genreMatch = await matchGenres(meta.genres)
  const credits: Array<{ personId: number; credit: string }> = []
  for (const person of meta.people) {
    const id = await personId(person.name)
    if (id && !credits.some((c) => c.personId === id && c.credit === person.credit))
      credits.push({ personId: id, credit: person.credit })
  }

  const seriesId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(series)
      .values({
        slug,
        title: meta.title,
        type: meta.type,
        status: meta.status,
        // Draft, always. See the note at the top of this file.
        state: 'draft',
        synopsis: meta.synopsis,
        country: meta.country,
        releasedYear: meta.releasedYear,
        coverColor: meta.coverColor,
        ageRating: meta.ageRating,
      })
      .returning({ id: series.id })
    if (!created) throw new Error('series insert returned no row')
    if (meta.altTitles.length)
      await tx
        .insert(seriesTitles)
        .values(meta.altTitles.map((title) => ({ seriesId: created.id, title, lang: null })))
        .onConflictDoNothing()
    if (credits.length)
      await tx.insert(seriesPeople).values(credits.map((c) => ({ seriesId: created.id, ...c })))
    if (genreMatch.ids.length)
      await tx
        .insert(seriesGenres)
        .values(genreMatch.ids.map((genreId) => ({ seriesId: created.id, genreId })))
        .onConflictDoNothing()
    return created.id
  })

  const coverQueued = meta.coverUrl ? await attachCover(seriesId, meta.coverUrl, actorId) : false
  return {
    seriesId,
    slug,
    title: meta.title,
    coverQueued,
    unmatchedGenres: genreMatch.unmatched,
  }
}
