import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle } from '../client.js'
import { runMigrations } from '../migrate.js'
import {
  bookmarks,
  chapters,
  genres,
  readingProgress,
  series,
  seriesGenres,
  users,
} from '../schema/index.js'
import { recommendedSeries } from './series.js'

/**
 * `recommendedSeries` against a real Postgres (PGlite). The exclusions are the whole point
 * of the query — "you might like this thing you finished last week" is the recommendation
 * that tells a reader the site is not paying attention — and they are `not exists`
 * subqueries, so only a real database proves them.
 */

let dir: string
let handle: DbHandle
let db: Db

const id: Record<string, number> = {}
const genreId: Record<string, number> = {}
let reader = 0
let stranger = 0

/** Slugs of the recommendations, in the order the query returned them. */
const recommend = async (
  seriesId: number,
  opts?: Parameters<typeof recommendedSeries>[2],
): Promise<string[]> => (await recommendedSeries(db, seriesId, opts)).map((r) => r.slug)

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-recs-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)

  const people = await db
    .insert(users)
    .values([
      { email: 'reader@example.com', username: 'reader' },
      { email: 'stranger@example.com', username: 'stranger' },
    ])
    .returning({ id: users.id, username: users.username })
  reader = people.find((u) => u.username === 'reader')?.id ?? 0
  stranger = people.find((u) => u.username === 'stranger')?.id ?? 0

  const g = await db
    .insert(genres)
    .values([
      { slug: 'action', name: 'Action', kind: 'genre' },
      { slug: 'romance', name: 'Romance', kind: 'genre' },
      { slug: 'cooking', name: 'Cooking', kind: 'genre' },
    ])
    .returning({ id: genres.id, slug: genres.slug })
  for (const row of g) genreId[row.slug] = row.id

  const rows = await db
    .insert(series)
    .values([
      // The series being read. Action + Romance.
      { slug: 'source', title: 'Source', type: 'manhwa', state: 'published', viewCount: 10 },
      // Two shared genres, modest reach, few but perfect ratings.
      {
        slug: 'twin-genre',
        title: 'Twin Genre',
        type: 'manhwa',
        state: 'published',
        viewCount: 50,
        ratingSum: 30,
        ratingCount: 3,
      },
      // One shared genre, the biggest audience on the site.
      {
        slug: 'one-genre-popular',
        title: 'One Genre Popular',
        type: 'manhwa',
        state: 'published',
        viewCount: 9000,
        ratingSum: 8000,
        ratingCount: 1000,
      },
      // One shared genre, well rated by a lot of people.
      {
        slug: 'one-genre-loved',
        title: 'One Genre Loved',
        type: 'manhwa',
        state: 'published',
        viewCount: 100,
        ratingSum: 9400,
        ratingCount: 1000,
      },
      // Shares nothing.
      {
        slug: 'unrelated',
        title: 'Unrelated',
        type: 'manhwa',
        state: 'published',
        viewCount: 99999,
      },
      // Shares a genre but must never be recommended.
      { slug: 'draft', title: 'Draft', type: 'manhwa', state: 'draft', viewCount: 9999 },
      {
        slug: 'deleted',
        title: 'Deleted',
        type: 'manhwa',
        state: 'published',
        viewCount: 9999,
        deletedAt: new Date(),
      },
      // A series with no genres at all, for the fallback path.
      { slug: 'genreless', title: 'Genreless', type: 'manhwa', state: 'published', viewCount: 5 },
    ])
    .returning({ id: series.id, slug: series.slug })
  for (const row of rows) id[row.slug] = row.id

  const link = (slug: string, kinds: string[]) =>
    kinds.map((k) => ({ seriesId: id[slug] as number, genreId: genreId[k] as number }))
  await db
    .insert(seriesGenres)
    .values([
      ...link('source', ['action', 'romance']),
      ...link('twin-genre', ['action', 'romance']),
      ...link('one-genre-popular', ['action']),
      ...link('one-genre-loved', ['action']),
      ...link('unrelated', ['cooking']),
      ...link('draft', ['action', 'romance']),
      ...link('deleted', ['action', 'romance']),
    ])

  // One published chapter per series, so `reading_progress` has something to point at.
  await db.insert(chapters).values(
    rows.map((r, i) => ({
      seriesId: r.id,
      number: 1,
      state: 'published' as const,
      pageCount: 1,
      publishedAt: new Date(Date.now() - i * 1000),
    })),
  )
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.delete(readingProgress)
  await db.delete(bookmarks)
})

/** Give this reader a `reading_progress` row for `slug` — "already read". */
const markRead = async (userId: number, slug: string) => {
  const seriesId = id[slug] as number
  const [chapter] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.seriesId, seriesId))
    .limit(1)
  await db.insert(readingProgress).values({ userId, seriesId, chapterId: chapter?.id as number })
}

describe('recommendedSeries — what it picks', () => {
  it('prefers series sharing more genres, whatever their reach', async () => {
    const slugs = await recommend(id.source as number)
    expect(slugs[0]).toBe('twin-genre')
    expect(slugs).not.toContain('unrelated')
  })

  it('breaks a genre tie on rating quality, not on a handful of perfect scores', async () => {
    const slugs = await recommend(id.source as number)
    // Both share one genre; the one rated 9.4 by a thousand people comes before the one
    // rated 8.0 by a thousand, and both come after the two-genre match.
    expect(slugs.slice(0, 3)).toEqual(['twin-genre', 'one-genre-loved', 'one-genre-popular'])
  })

  it('never recommends the series being read, a draft, or a deleted row', async () => {
    const slugs = await recommend(id.source as number)
    expect(slugs).not.toContain('source')
    expect(slugs).not.toContain('draft')
    expect(slugs).not.toContain('deleted')
  })

  it('honours the limit', async () => {
    expect(await recommend(id.source as number, { limit: 2 })).toHaveLength(2)
  })

  it('still accepts a bare limit, the way the series page calls it', async () => {
    expect(await recommend(id.source as number, 2)).toHaveLength(2)
  })

  it('falls back to popular series when the source has no genres', async () => {
    const slugs = await recommend(id.genreless as number)
    expect(slugs[0]).toBe('unrelated')
    expect(slugs).not.toContain('genreless')
    expect(slugs).not.toContain('draft')
  })
})

describe('recommendedSeries — exclusions', () => {
  it('drops a series this reader has already opened', async () => {
    await markRead(reader, 'twin-genre')
    const slugs = await recommend(id.source as number, { excludeReadBy: reader })
    expect(slugs).not.toContain('twin-genre')
    expect(slugs).toContain('one-genre-loved')
  })

  it('drops a series this reader has bookmarked', async () => {
    await db.insert(bookmarks).values({ userId: reader, seriesId: id['twin-genre'] as number })
    const slugs = await recommend(id.source as number, { excludeBookmarkedBy: reader })
    expect(slugs).not.toContain('twin-genre')
  })

  it('does not let one reader’s history hide anything from another', async () => {
    await markRead(stranger, 'twin-genre')
    expect(await recommend(id.source as number, { excludeReadBy: reader })).toContain('twin-genre')
  })

  it('shows everything to an anonymous reader, who has no history to exclude', async () => {
    await markRead(reader, 'twin-genre')
    const slugs = await recommend(id.source as number, {
      excludeReadBy: null,
      excludeBookmarkedBy: null,
    })
    expect(slugs).toContain('twin-genre')
  })

  it('applies both exclusions at once', async () => {
    await markRead(reader, 'twin-genre')
    await db.insert(bookmarks).values({ userId: reader, seriesId: id['one-genre-loved'] as number })
    const slugs = await recommend(id.source as number, {
      excludeReadBy: reader,
      excludeBookmarkedBy: reader,
    })
    expect(slugs).toEqual(['one-genre-popular'])
  })

  it('excludes read series from the genreless fallback too', async () => {
    await markRead(reader, 'unrelated')
    const slugs = await recommend(id.genreless as number, { excludeReadBy: reader })
    expect(slugs).not.toContain('unrelated')
  })

  it('returns nothing rather than something already read, unless asked to fall back', async () => {
    for (const slug of ['twin-genre', 'one-genre-popular', 'one-genre-loved']) {
      await markRead(reader, slug)
    }
    expect(await recommend(id.source as number, { excludeReadBy: reader })).toEqual([])
    // With the fallback on, an off-genre series they have not read beats an empty rail.
    const fallback = await recommend(id.source as number, {
      excludeReadBy: reader,
      fallbackToPopular: true,
    })
    expect(fallback[0]).toBe('unrelated')
    expect(fallback).not.toContain('twin-genre')
  })

  it('does not resurrect a read series through the fallback', async () => {
    for (const slug of ['twin-genre', 'one-genre-popular', 'one-genre-loved', 'unrelated']) {
      await markRead(reader, slug)
    }
    const slugs = await recommend(id.source as number, {
      excludeReadBy: reader,
      fallbackToPopular: true,
    })
    expect(slugs).toEqual(['genreless'])
  })
})
