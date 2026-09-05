import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle, executeRows } from '../client.js'
import { runMigrations } from '../migrate.js'
import {
  adminGenres,
  createGenre,
  genreCounts,
  genreTombstoneSlugFor,
  mergeGenres,
  previewGenreMerge,
  reorderGenres,
  restoreGenre,
  softDeleteGenre,
  updateGenre,
} from './genres.js'

/**
 * Genre management against a real Postgres (PGlite), because everything asserted here is a
 * property of the SQL and of the schema's own constraints — the unique slug index, the
 * primary key on (series_id, genre_id) that a careless merge would violate, and the
 * `slug_history` key that decides whether an old URL still answers.
 *
 * The load-bearing test is `leaves nothing behind`: it walks `information_schema` for every
 * column in the database that points at a genre and asserts the loser has no rows left in
 * any of them. A table added later that forgets to join the merge fails here rather than
 * silently orphaning its rows.
 */

let dir: string
let handle: DbHandle
let db: Db

const ids = { actor: 0, s1: 0, s2: 0, s3: 0 }

const scalar = async (query: ReturnType<typeof sql>): Promise<number> => {
  const [row] = await executeRows<{ n: number }>(db, query)
  return Number(row?.n ?? 0)
}

const newGenre = async (slug: string, name: string, kind = 'genre') =>
  (await createGenre(db, { slug, name, kind })).id

const tag = async (seriesId: number, genreId: number) =>
  db.execute(sql`insert into series_genres (series_id, genre_id) values (${seriesId}, ${genreId})`)

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-genres-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  for (const table of ['audit_log', 'series_genres', 'slug_history', 'redirects'])
    await db.execute(sql`delete from ${sql.raw(table)}`)
  await db.execute(sql`update genres set merged_into_id = null`)
  await db.execute(sql`delete from genres`)
  await db.execute(sql`delete from series`)
  await db.execute(sql`delete from users`)

  const [actor] = await executeRows<{ id: number }>(
    db,
    sql`insert into users (email, username, role) values ('boss@example.com', 'boss', 'admin')
        returning id`,
  )
  ids.actor = Number(actor?.id)

  const rows = await executeRows<{ id: number; slug: string }>(
    db,
    sql`insert into series (slug, title, type, state) values
          ('one', 'One', 'manhwa', 'published'),
          ('two', 'Two', 'manhwa', 'published'),
          ('three', 'Three', 'manhwa', 'draft')
        returning id, slug::text as slug`,
  )
  ids.s1 = Number(rows.find((r) => r.slug === 'one')?.id)
  ids.s2 = Number(rows.find((r) => r.slug === 'two')?.id)
  ids.s3 = Number(rows.find((r) => r.slug === 'three')?.id)
})

describe('merge', () => {
  /**
   * The fixture that makes the merge non-trivial: one series has only the winner, one only
   * the loser, and one has both. The third is the case a naive `UPDATE ... SET genre_id`
   * turns into a primary key violation, and a naive `DELETE` turns into a lost tag.
   */
  const fixture = async () => {
    const winner = await newGenre('action', 'Action')
    const loser = await newGenre('akushon', 'Akushon')
    await tag(ids.s1, winner)
    await tag(ids.s2, loser)
    await tag(ids.s3, winner)
    await tag(ids.s3, loser)
    return { winner, loser }
  }

  it('moves what it can, folds what it cannot, and orphans nothing', async () => {
    const { winner, loser } = await fixture()
    const preview = await previewGenreMerge(db, winner, loser)
    expect(preview.refusals).toEqual([])
    // s2 only had the loser (moves); s3 had both (folds).
    expect(preview.move).toBe(1)
    expect(preview.merge).toBe(1)

    const result = await mergeGenres(db, { winnerId: winner, loserId: loser, actorId: ids.actor })
    expect(result.ok).toBe(true)

    // Nothing is left pointing at the loser…
    expect(
      await scalar(sql`select count(*)::int as n from series_genres where genre_id = ${loser}`),
    ).toBe(0)
    // …every series that had either genre now has the winner, exactly once…
    const tagged = await executeRows<{ series_id: number; n: number }>(
      db,
      sql`select series_id, count(*)::int as n from series_genres where genre_id = ${winner}
          group by series_id order by series_id`,
    )
    expect(tagged.map((r) => Number(r.n))).toEqual([1, 1, 1])
    expect(tagged.map((r) => Number(r.series_id)).sort((a, b) => a - b)).toEqual(
      [ids.s1, ids.s2, ids.s3].sort((a, b) => a - b),
    )
    // …and the join table holds nothing else at all.
    expect(await scalar(sql`select count(*)::int as n from series_genres`)).toBe(3)
  })

  /**
   * The sweep. Every foreign key in the database that points at `genres.id` is checked for
   * rows still naming the loser. `genres.merged_into_id` is the one legitimate reference to
   * a retired genre — it points *from* the loser *at* the winner — so it is excluded by
   * name rather than by luck.
   */
  it('leaves nothing behind: no column that points at a genre still names the loser', async () => {
    const { winner, loser } = await fixture()
    await mergeGenres(db, { winnerId: winner, loserId: loser, actorId: ids.actor })

    const refs = await executeRows<{ table_name: string; column_name: string }>(
      db,
      sql`select kcu.table_name, kcu.column_name
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
          join information_schema.constraint_column_usage ccu
            on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
          where tc.constraint_type = 'FOREIGN KEY'
            and ccu.table_name = 'genres' and ccu.column_name = 'id'
            and tc.table_schema = 'public'`,
    )
    expect(refs.length).toBeGreaterThan(0)
    const leftovers: string[] = []
    for (const r of refs) {
      if (r.table_name === 'genres' && r.column_name === 'merged_into_id') continue
      const n = await scalar(
        sql`select count(*)::int as n from ${sql.raw(`"${r.table_name}"`)}
            where ${sql.raw(`"${r.column_name}"`)} = ${loser}`,
      )
      if (n > 0) leftovers.push(`${r.table_name}.${r.column_name}: ${n}`)
    }
    expect(leftovers).toEqual([])
  })

  it("keeps the loser's URL answering and frees its slug", async () => {
    const { winner, loser } = await fixture()
    await mergeGenres(db, { winnerId: winner, loserId: loser, actorId: ids.actor })

    const [redirect] = await executeRows<{ to_path: string; status: number }>(
      db,
      sql`select to_path, status from redirects where from_path = '/genres/akushon' and deleted_at is null`,
    )
    expect(redirect?.to_path).toBe('/genres/action')
    expect(Number(redirect?.status)).toBe(301)

    // slug_history is what makes /genres/akushon/feed resolve, not just the page itself.
    const [history] = await executeRows<{ entity_id: number }>(
      db,
      sql`select entity_id from slug_history where entity_type = 'genre' and old_slug = 'akushon'`,
    )
    expect(Number(history?.entity_id)).toBe(winner)

    // The retired row gives its slug back, so 'akushon' can be used again.
    const [retired] = await executeRows<{ slug: string; merged_into_id: number }>(
      db,
      sql`select slug::text as slug, merged_into_id from genres where id = ${loser}`,
    )
    expect(retired?.slug).toBe(genreTombstoneSlugFor(loser, 'akushon'))
    expect(Number(retired?.merged_into_id)).toBe(winner)
  })

  it('names the loser it was known by before, so older URLs follow too', async () => {
    const winner = await newGenre('action', 'Action')
    const loser = await newGenre('akushon', 'Akushon')
    await updateGenre(db, loser, { name: 'Akushon', slug: 'akushun', kind: 'genre' })
    await mergeGenres(db, { winnerId: winner, loserId: loser, actorId: ids.actor })
    const rows = await executeRows<{ old_slug: string; entity_id: number }>(
      db,
      sql`select old_slug::text as old_slug, entity_id from slug_history
          where entity_type = 'genre' order by old_slug`,
    )
    expect(rows.map((r) => r.old_slug)).toEqual(['akushon', 'akushun'])
    expect(rows.every((r) => Number(r.entity_id) === winner)).toBe(true)
  })

  it('writes exactly one audit row, in the same transaction as the move', async () => {
    const { winner, loser } = await fixture()
    const result = await mergeGenres(db, { winnerId: winner, loserId: loser, actorId: ids.actor })
    const rows = await executeRows<{ action: string; target_id: number; after: unknown }>(
      db,
      sql`select action, target_id, after from audit_log`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.action).toBe('genre.merge')
    expect(Number(rows[0]?.target_id)).toBe(winner)
    const after = rows[0]?.after as { move: number; merge: number }
    expect(after.move).toBe(1)
    expect(after.merge).toBe(1)
    expect(result.ok && result.auditId).toBeTruthy()
  })

  it('refuses a merge into itself and writes nothing', async () => {
    const winner = await newGenre('action', 'Action')
    await tag(ids.s1, winner)
    const result = await mergeGenres(db, { winnerId: winner, loserId: winner, actorId: ids.actor })
    expect(result.ok).toBe(false)
    expect(await scalar(sql`select count(*)::int as n from audit_log`)).toBe(0)
    expect(await scalar(sql`select count(*)::int as n from series_genres`)).toBe(1)
  })

  it('refuses a merge with a retired side', async () => {
    const winner = await newGenre('action', 'Action')
    const loser = await newGenre('akushon', 'Akushon')
    await softDeleteGenre(db, loser)
    const result = await mergeGenres(db, { winnerId: winner, loserId: loser, actorId: ids.actor })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.refusals.map((r) => r.code)).toContain('deleted')
  })

  it('warns rather than refuses when the two sides are different kinds', async () => {
    const winner = await newGenre('isekai', 'Isekai', 'theme')
    const loser = await newGenre('isekai-genre', 'Isekai', 'genre')
    const preview = await previewGenreMerge(db, winner, loser)
    expect(preview.refusals).toEqual([])
    expect(preview.warnings.map((w) => w.code)).toContain('kind_mismatch')
  })
})

describe('retire and restore', () => {
  it('keeps the tags so a restore brings the series back with it', async () => {
    const g = await newGenre('romance', 'Romance')
    await tag(ids.s1, g)
    await tag(ids.s2, g)

    await softDeleteGenre(db, g)
    // The rows survive — this is the whole reason a delete here is soft.
    expect(
      await scalar(sql`select count(*)::int as n from series_genres where genre_id = ${g}`),
    ).toBe(2)
    // …but the genre is gone from every public surface.
    expect((await genreCounts(db)).map((r) => r.slug)).not.toContain('romance')

    const back = await restoreGenre(db, g)
    expect(back?.deletedAt).toBeNull()
    expect((await genreCounts(db)).map((r) => r.slug)).toContain('romance')
  })

  it('refuses to restore a genre that lost a merge', async () => {
    const winner = await newGenre('action', 'Action')
    const loser = await newGenre('akushon', 'Akushon')
    await mergeGenres(db, { winnerId: winner, loserId: loser, actorId: ids.actor })
    expect(await restoreGenre(db, loser)).toBeNull()
  })
})

describe('slugs', () => {
  it('a rename leaves a redirect for the old slug', async () => {
    const g = await newGenre('sci-fi', 'Sci Fi')
    const res = await updateGenre(db, g, {
      name: 'Science fiction',
      slug: 'science-fiction',
      kind: 'genre',
    })
    expect(res?.redirectedFrom).toBe('sci-fi')
    const [row] = await executeRows<{ entity_id: number }>(
      db,
      sql`select entity_id from slug_history where entity_type = 'genre' and old_slug = 'sci-fi'`,
    )
    expect(Number(row?.entity_id)).toBe(g)
  })

  /**
   * The inverse, which is the one that actually bites: a slug that history still claims is
   * taken back by a live genre. Without dropping the history row the new page would 301 to
   * the old one and be unreachable at its own address.
   */
  it('a live slug beats a stale redirect', async () => {
    const g = await newGenre('sci-fi', 'Sci Fi')
    await updateGenre(db, g, { name: 'Science fiction', slug: 'science-fiction', kind: 'genre' })
    expect(
      await scalar(
        sql`select count(*)::int as n from slug_history where entity_type = 'genre' and old_slug = 'sci-fi'`,
      ),
    ).toBe(1)

    await createGenre(db, { name: 'Sci-fi', slug: 'sci-fi', kind: 'genre' })
    expect(
      await scalar(
        sql`select count(*)::int as n from slug_history where entity_type = 'genre' and old_slug = 'sci-fi'`,
      ),
    ).toBe(0)
  })
})

describe('order', () => {
  it('writes dense positions and ignores ids from another kind', async () => {
    const a = await newGenre('a', 'A')
    const b = await newGenre('b', 'B')
    const c = await newGenre('c', 'C')
    const theme = await newGenre('t', 'T', 'theme')

    const moved = await reorderGenres(db, 'genre', [c, a, b, theme])
    expect(moved).toBe(3) // the theme id is not a member of this kind

    const order = (await genreCounts(db, 'genre')).map((g) => g.slug)
    expect(order).toEqual(['c', 'a', 'b'])
    const positions = (await adminGenres(db))
      .filter((g) => g.kind === 'genre')
      .map((g) => g.position)
    expect(positions).toEqual([1, 2, 3])
  })

  it('a new genre lands at the end of its kind', async () => {
    await newGenre('a', 'A')
    await newGenre('b', 'B')
    const c = await createGenre(db, { name: 'C', slug: 'c', kind: 'genre' })
    expect(c.position).toBe(3)
  })
})

describe('counts', () => {
  it('separates what is tagged from what a reader can see', async () => {
    const g = await newGenre('drama', 'Drama')
    await tag(ids.s1, g) // published
    await tag(ids.s3, g) // draft
    const [admin] = (await adminGenres(db)).filter((r) => r.slug === 'drama')
    expect(admin?.seriesCount).toBe(2)
    expect(admin?.publishedCount).toBe(1)
    expect((await genreCounts(db)).find((r) => r.slug === 'drama')?.count).toBe(1)
  })
})
