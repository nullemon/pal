import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle, executeRows } from '../client.js'
import { runMigrations } from '../migrate.js'
import { findDuplicateSeries, scorePair } from './duplicates.js'

/**
 * Duplicate detection against a real Postgres, because the whole mechanism is `pg_trgm` and
 * two normalisation expressions — a mocked database would only be testing the fixture.
 */

let dir: string
let handle: DbHandle
let db: Db
const id: Record<string, number> = {}

const add = async (
  key: string,
  slug: string,
  title: string,
  opts: { type?: string; alts?: string[]; year?: number; genres?: number[]; person?: number } = {},
) => {
  const [row] = await executeRows<{ id: number }>(
    db,
    sql`insert into series (slug, title, type, state, released_year)
        values (${slug}, ${title}, ${sql.raw(`'${opts.type ?? 'manhwa'}'`)}, 'published', ${opts.year ?? 2021})
        returning id`,
  )
  id[key] = Number(row?.id)
  for (const alt of opts.alts ?? [])
    await db.execute(sql`insert into series_titles (series_id, title) values (${id[key]}, ${alt})`)
  for (const g of opts.genres ?? [])
    await db.execute(sql`insert into series_genres (series_id, genre_id) values (${id[key]}, ${g})`)
  if (opts.person)
    await db.execute(
      sql`insert into series_people (series_id, person_id, credit) values (${id[key]}, ${opts.person}, 'author')`,
    )
  return id[key]
}

const pairOf = (rows: Awaited<ReturnType<typeof findDuplicateSeries>>, a: number, b: number) =>
  rows.find((r) => (r.a.id === a && r.b.id === b) || (r.a.id === b && r.b.id === a))

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-dupes-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)

  const [genre] = await executeRows<{ id: number }>(
    db,
    sql`insert into genres (slug, name) values ('action', 'Action') returning id`,
  )
  const [person] = await executeRows<{ id: number }>(
    db,
    sql`insert into people (slug, name) values ('chugong', 'Chugong') returning id`,
  )
  const g = Number(genre?.id)
  const p = Number(person?.id)

  // The three shapes the importer actually produces.
  await add('solo', 'solo-leveling', 'Solo Leveling', { genres: [g], person: p })
  await add('soloDup', 'solo-leveling-2', 'Solo Leveling', { genres: [g], person: p })
  await add('romanised', 'na-honjaman-level-up', 'Na Honjaman Level Up', {
    alts: ['Solo Leveling'],
    genres: [g],
  })
  await add('season', 'the-beginning-after-the-end', 'The Beginning After The End', { genres: [g] })
  await add('seasonTwo', 'beginning-after-the-end-season-2', 'Beginning After the End: Season 2', {
    genres: [g],
  })
  // Not duplicates, however close the names look.
  await add('novel', 'solo-leveling-novel', 'Solo Leveling', { type: 'novel', genres: [g] })
  await add('unrelated', 'overgrowth', 'Overgrowth', { genres: [g] })
  await add('sequelish', 'tower-of-god', 'Tower of God', { genres: [g] })
  await add('otherTower', 'tower-of-babel', 'Tower of Babel', { genres: [g] })
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

describe('scorePair', () => {
  const base = {
    nameSim: 0,
    aName: null as string | null,
    bName: null as string | null,
    exactAlias: false,
    slugRoot: null as string | null,
    sharedPeople: [] as string[],
    sharedGenres: [] as string[],
    aType: 'manhwa' as const,
    bType: 'manhwa' as const,
    aYear: null as number | null,
    bYear: null as number | null,
    aGenreCount: 0,
    bGenreCount: 0,
  }

  it('gives every point it awards a reason the operator can read', () => {
    const { score, reasons } = scorePair({
      ...base,
      nameSim: 1,
      aName: 'Solo Leveling',
      bName: 'Solo Leveling',
      exactAlias: true,
      exactAliasA: 'Solo Leveling',
      exactAliasB: 'Solo Leveling',
      slugRoot: 'sololeveling',
      sharedPeople: ['Chugong'],
    })
    expect(score).toBe(100)
    expect(reasons.reduce((t, r) => t + r.points, 0)).toBeGreaterThanOrEqual(score)
    expect(reasons.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['title_similarity', 'exact_alias', 'slug_root', 'shared_creator']),
    )
    for (const r of reasons) expect(r.detail.length).toBeGreaterThan(0)
  })

  it('cannot flag a pair on corroboration alone', () => {
    // Same creator, same genres, same year, same type — and names that share nothing.
    const { score } = scorePair({
      ...base,
      sharedPeople: ['Chugong'],
      sharedGenres: ['Action', 'Drama'],
      aGenreCount: 2,
      bGenreCount: 2,
      aYear: 2018,
      bYear: 2018,
    })
    expect(score).toBeLessThan(40)
  })

  it('pushes a novel and its comic adaptation below the threshold however well the names match', () => {
    const { score, reasons } = scorePair({
      ...base,
      nameSim: 1,
      aName: 'Solo Leveling',
      bName: 'Solo Leveling',
      exactAlias: true,
      bType: 'novel',
    })
    expect(reasons.find((r) => r.kind === 'type_mismatch')?.points).toBe(-30)
    // Zeroed rather than merely reduced: the merge refuses this pair, so it is not a
    // candidate at any score, and the reason is still there for the operator to read.
    expect(score).toBe(0)
  })
})

describe('findDuplicateSeries', () => {
  it('finds the same title under a disambiguated slug', async () => {
    const rows = await findDuplicateSeries(db)
    const hit = pairOf(rows, id.solo as number, id.soloDup as number)
    expect(hit).toBeDefined()
    expect(hit?.score).toBeGreaterThanOrEqual(80)
    expect(hit?.reasons.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['title_similarity', 'exact_alias', 'slug_root', 'shared_creator']),
    )
  })

  it('finds an alternative romanisation through series_titles, not the primary title', async () => {
    const rows = await findDuplicateSeries(db)
    const hit = pairOf(rows, id.solo as number, id.romanised as number)
    expect(hit).toBeDefined()
    expect(hit?.reasons.map((r) => r.kind)).toContain('exact_alias')
    expect(hit?.bestMatch?.similarity).toBeGreaterThan(0)
  })

  it('sees through a season suffix and a dropped article', async () => {
    const rows = await findDuplicateSeries(db)
    const hit = pairOf(rows, id.season as number, id.seasonTwo as number)
    expect(hit).toBeDefined()
    expect(hit?.reasons.map((r) => r.kind)).toContain('exact_alias')
  })

  it('does not flag an adaptation or two unrelated titles', async () => {
    const rows = await findDuplicateSeries(db)
    expect(pairOf(rows, id.solo as number, id.novel as number)).toBeUndefined()
    expect(pairOf(rows, id.solo as number, id.unrelated as number)).toBeUndefined()
    expect(pairOf(rows, id.sequelish as number, id.otherTower as number)).toBeUndefined()
  })

  it('leads with the side readers have invested in, and reports the chapter overlap', async () => {
    await db.execute(
      sql`insert into chapters (series_id, number, state) values (${id.solo}, 1, 'published'), (${id.soloDup}, 1, 'published')`,
    )
    await db.execute(sql`update series set bookmark_count = 900 where id = ${id.soloDup}`)
    const rows = await findDuplicateSeries(db)
    const hit = pairOf(rows, id.solo as number, id.soloDup as number)
    expect(hit?.a.id).toBe(id.soloDup)
    expect(hit?.overlappingChapters).toEqual([1])
    await db.execute(sql`delete from chapters where series_id in (${id.solo}, ${id.soloDup})`)
    await db.execute(sql`update series set bookmark_count = 0 where id = ${id.soloDup}`)
  })

  it('can be narrowed to one series', async () => {
    const rows = await findDuplicateSeries(db, { seriesId: id.season as number })
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect([r.a.id, r.b.id]).toContain(id.season)
  })
})
