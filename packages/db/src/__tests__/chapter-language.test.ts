import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Local helper so the expectations below read as the question they are asking. */
const chapterIs = (sid: number, number: number, language: string) =>
  and(eq(chapters.seriesId, sid), eq(chapters.number, number), eq(chapters.language, language))

import { createDb, type Db, type DbHandle } from '../client.js'
import { runMigrations } from '../migrate.js'
import { chapterList, chapterWithPages, seriesLanguages } from '../queries/chapters.js'
import { chapters, series } from '../schema/index.js'

/**
 * Chapters in more than one language (migration 9044).
 *
 * Two things are asserted against a real database rather than reasoned about, because both
 * are constraints and query shapes rather than logic:
 *
 * 1. A German chapter 1 can exist beside an English chapter 1. The old
 *    `(series_id, number)` unique constraint made that an insert error, so the feature was
 *    impossible until it changed.
 * 2. Next and Previous stay in the language being read. Without the language in the neighbour
 *    filter, Next from German chapter 1 returns English chapter 2 — the reader is moved into
 *    another language mid-series and nothing errors, which is the worst kind of wrong.
 */

let dir: string
let handle: DbHandle
let db: Db
let seriesId: number

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-lang-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  const [row] = await db
    .insert(series)
    .values({ slug: 'solo', title: 'Solo', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  seriesId = row?.id ?? 0

  const published = { state: 'published' as const, publishedAt: new Date(), pageCount: 1 }
  await db.insert(chapters).values([
    { seriesId, number: 1, language: 'en', ...published },
    { seriesId, number: 2, language: 'en', ...published },
    { seriesId, number: 3, language: 'en', ...published },
    { seriesId, number: 1, language: 'de', ...published },
    { seriesId, number: 2, language: 'de', ...published },
  ])
})

afterAll(async () => {
  await handle?.close?.()
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('chapters in several languages', () => {
  it('allows the same number in two languages', async () => {
    const rows = await db.select().from(chapters)
    expect(rows).toHaveLength(5)
  })

  it('still refuses two chapters with the same number in one language', async () => {
    await expect(
      db.insert(chapters).values({ seriesId, number: 1, language: 'de' }),
    ).rejects.toThrow()
  })

  it('defaults to English, so rows written before the column existed are English', async () => {
    const [row] = await db
      .insert(chapters)
      .values({ seriesId, number: 99 })
      .returning({ language: chapters.language })
    expect(row?.language).toBe('en')
  })
})

describe('chapterList', () => {
  it('returns one language when asked', async () => {
    const de = await chapterList(db, seriesId, 'asc', { language: 'de' })
    expect(de.map((c) => Number(c.number))).toEqual([1, 2])
  })

  it('returns every language when not asked, for the admin lists', async () => {
    const all = await chapterList(db, seriesId, 'asc', { includeUnpublished: true })
    expect(all.length).toBeGreaterThan(5)
  })
})

describe('chapterWithPages neighbours', () => {
  it('keeps Next in the language being read', async () => {
    // The whole point. In English this would be chapter 2 as well, so the test only means
    // something because it checks the id, not the number.
    const de1 = await chapterWithPages(db, seriesId, 1, { language: 'de' })
    const [de2] = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(chapterIs(seriesId, 2, 'de'))
    expect(de1?.next?.id).toBe(de2?.id)
  })

  it('has no Next past the end of that language, even when another language continues', async () => {
    // German stops at 2 while English runs to 3. Without the language filter this returns
    // English chapter 3 and the reader is silently switched.
    const de2 = await chapterWithPages(db, seriesId, 2, { language: 'de' })
    expect(de2?.next).toBeNull()
  })

  it('keeps Previous in language too', async () => {
    const de2 = await chapterWithPages(db, seriesId, 2, { language: 'de' })
    const [de1] = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(chapterIs(seriesId, 1, 'de'))
    expect(de2?.prev?.id).toBe(de1?.id)
  })

  it('defaults to English, so every pre-9044 URL resolves to what it always did', async () => {
    const en = await chapterWithPages(db, seriesId, 1)
    expect(en?.chapter.language).toBe('en')
    expect(en?.next?.number).toBe(2)
  })

  it('is null for a language this series does not have', async () => {
    expect(await chapterWithPages(db, seriesId, 1, { language: 'fr' })).toBeNull()
  })
})

describe('seriesLanguages', () => {
  it('lists only languages that exist, most chapters first', async () => {
    const langs = await seriesLanguages(db, seriesId)
    expect(langs[0]?.language).toBe('en')
    expect(langs.map((l) => l.language)).toEqual(['en', 'de'])
    expect(langs.find((l) => l.language === 'de')?.chapters).toBe(2)
  })
})
