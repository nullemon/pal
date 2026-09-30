import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDb, type Db, type DbHandle, people, series, seriesPeople } from '@palscans/db'
import { runMigrations } from '@palscans/db/migrate'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { duplicateCandidates, mergePeople } from '@/components/admin/server/people'

/**
 * Folding a duplicate author into the one the catalogue already uses.
 *
 * Asserted against a real database because the failure mode is a constraint, not logic:
 * `series_people` is keyed on `(series_id, person_id, credit)`, so the obvious implementation
 * — UPDATE person_id — collides exactly when a series already credits both spellings in the
 * same role. That is not an edge case, it is what a duplicate looks like once someone has
 * fixed one series by hand.
 */

let dir: string
let handle: DbHandle
let db: Db

const person = async (name: string, slug: string) => {
  const [row] = await db.insert(people).values({ name, slug }).returning({ id: people.id })
  return row?.id ?? 0
}

const work = async (slug: string) => {
  const [row] = await db
    .insert(series)
    .values({ slug, title: slug, type: 'manga', state: 'published' })
    .returning({ id: series.id })
  return row?.id ?? 0
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-people-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
})

afterAll(async () => {
  await handle?.close?.()
  if (dir) await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.delete(seriesPeople)
  await db.delete(people)
  await db.delete(series)
})

describe('mergePeople', () => {
  it('moves credits to the winner and deletes the loser', async () => {
    const winner = await person('ONE', 'one')
    const loser = await person('One', 'one-2')
    const a = await work('opm')
    await db.insert(seriesPeople).values({ seriesId: a, personId: loser, credit: 'author' })

    const result = await mergePeople(winner, loser, db)
    expect(result?.moved).toBe(1)

    const rows = await db.select().from(seriesPeople)
    expect(rows).toEqual([{ seriesId: a, personId: winner, credit: 'author' }])
    expect(await db.select().from(people)).toHaveLength(1)
  })

  it('survives a series that already credits both spellings in the same role', async () => {
    // The collision the primary key produces. An UPDATE here fails outright.
    const winner = await person('Tite Kubo', 'tite-kubo')
    const loser = await person('Kubo Tite', 'kubo-tite')
    const a = await work('bleach')
    await db.insert(seriesPeople).values([
      { seriesId: a, personId: winner, credit: 'author' },
      { seriesId: a, personId: loser, credit: 'author' },
    ])

    const result = await mergePeople(winner, loser, db)
    expect(result?.moved).toBe(1)
    const rows = await db.select().from(seriesPeople)
    expect(rows).toEqual([{ seriesId: a, personId: winner, credit: 'author' }])
  })

  it('keeps the two roles apart when the same person holds both', async () => {
    const winner = await person('Yusuke Murata', 'yusuke-murata')
    const loser = await person('Murata Yusuke', 'murata-yusuke')
    const a = await work('eyeshield')
    await db.insert(seriesPeople).values([
      { seriesId: a, personId: winner, credit: 'artist' },
      { seriesId: a, personId: loser, credit: 'author' },
    ])

    await mergePeople(winner, loser, db)
    const rows = await db.select().from(seriesPeople)
    expect(rows.map((r) => r.credit).sort()).toEqual(['artist', 'author'])
    expect(rows.every((r) => r.personId === winner)).toBe(true)
  })

  it('refuses to merge a person into themselves', async () => {
    const id = await person('Solo', 'solo')
    expect(await mergePeople(id, id, db)).toBeNull()
  })

  it('returns null rather than half-applying when one side is gone', async () => {
    const winner = await person('Real', 'real')
    expect(await mergePeople(winner, 9999, db)).toBeNull()
    expect(await db.select().from(people)).toHaveLength(1)
  })
})

describe('duplicateCandidates', () => {
  it('pairs names differing only by word order, case or punctuation', async () => {
    await person('Tite Kubo', 'a')
    await person('KUBO  TITE', 'b')
    const pairs = await duplicateCandidates(db)
    expect(pairs).toHaveLength(1)
  })

  it('leaves genuinely different names alone', async () => {
    // The pair the screen must not offer: one letter apart, plausibly two people.
    await person('Ryu Ki-Woon', 'a')
    await person('Ryu Ki-Woong', 'b')
    expect(await duplicateCandidates(db)).toHaveLength(0)
  })

  it('offers the better-attested spelling as the one to keep', async () => {
    const big = await person('Tite Kubo', 'a')
    await person('Kubo Tite', 'b')
    const s = await work('bleach')
    await db.insert(seriesPeople).values({ seriesId: s, personId: big, credit: 'author' })
    const [pair] = await duplicateCandidates(db)
    expect(pair?.[0].id).toBe(big)
  })
})
