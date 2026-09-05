import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle } from '../client.js'
import { runMigrations } from '../migrate.js'
import { chapterReads, chapters, readingProgress, series, users } from '../schema/index.js'
import {
  currentProgress,
  decideProgress,
  mergeLocalProgress,
  observedAtFrom,
  TIE_WINDOW_MS,
  writeProgress,
} from './progress.js'

/**
 * The conflict rule (docs/06 "Progress and offline") against a real Postgres (PGlite).
 *
 * The rule is only interesting in the presence of an existing row, an `ON CONFLICT` and a
 * `greatest()` — a mocked database would prove nothing about any of them. The scenario that
 * matters is the one that was broken: a phone that read offline and flushed its beacon
 * hours later must not drag the pointer back from where a laptop reached in the meantime.
 */

let dir: string
let handle: DbHandle
let db: Db
const ids = { reader: 0, other: 0, series: 0, unpublished: 0, ch10: 0, ch11: 0, ch12: 0, gone: 0 }

const T = (iso: string) => new Date(iso)
const MORNING = T('2026-09-05T09:00:00Z')
const LUNCH = T('2026-09-05T12:00:00Z')
const EVENING = T('2026-09-05T20:00:00Z')

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-progress-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  const people = await db
    .insert(users)
    .values([{ email: 'reader@progress.test' }, { email: 'other@progress.test' }])
    .returning({ id: users.id, email: users.email })
  ids.reader = people.find((u) => u.email === 'reader@progress.test')?.id ?? 0
  ids.other = people.find((u) => u.email === 'other@progress.test')?.id ?? 0
  const [row] = await db
    .insert(series)
    .values({ slug: 'frost-monarch', title: 'Frost Monarch', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  ids.series = row?.id ?? 0
  const made = await db
    .insert(chapters)
    .values([
      { seriesId: ids.series, number: 10, state: 'published' },
      { seriesId: ids.series, number: 11, state: 'published' },
      { seriesId: ids.series, number: 12, state: 'published' },
      { seriesId: ids.series, number: 13, state: 'draft' },
    ])
    .returning({ id: chapters.id, number: chapters.number })
  const byNumber = (n: number) => made.find((c) => Number(c.number) === n)?.id ?? 0
  ids.ch10 = byNumber(10)
  ids.ch11 = byNumber(11)
  ids.ch12 = byNumber(12)
  ids.unpublished = byNumber(13)
  ids.gone = 9_999_999
}, 180_000)

afterAll(async () => {
  await handle?.close()
  if (dir) await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.delete(readingProgress)
  await db.delete(chapterReads)
})

const write = (
  chapterId: number,
  chapterNumber: number,
  pageIdx: number,
  observedAt: Date,
  userId = ids.reader,
) =>
  writeProgress(db, {
    userId,
    seriesId: ids.series,
    chapterId,
    chapterNumber,
    pageIdx,
    scrollPct: 0,
    observedAt,
  })

describe('the rule, on its own', () => {
  const at = (iso: string, chapterNumber: number, pageIdx: number) => ({
    chapterNumber,
    pageIdx,
    observedAt: T(iso),
  })

  it('accepts the first position a series ever gets', () => {
    expect(decideProgress(null, at('2026-09-05T09:00:00Z', 10, 4))).toBe('accepted')
  })

  it('refuses a position that describes an older moment', () => {
    const stored = at('2026-09-05T12:00:00Z', 12, 0)
    expect(decideProgress(stored, at('2026-09-05T09:00:00Z', 10, 4))).toBe('stale')
  })

  it('accepts a newer moment even when it is further back in the series', () => {
    // Re-reading chapter 3 after finishing 40 is reading, not a stale write.
    const stored = at('2026-09-05T09:00:00Z', 40, 2)
    expect(decideProgress(stored, at('2026-09-05T12:00:00Z', 3, 1))).toBe('accepted')
  })

  it('breaks a simultaneous tie by the further position', () => {
    const stored = at('2026-09-05T12:00:00Z', 12, 8)
    const sameMoment = new Date(stored.observedAt.getTime() + TIE_WINDOW_MS - 1).toISOString()
    expect(decideProgress(stored, at(sameMoment, 12, 3))).toBe('behind')
    expect(decideProgress(stored, at(sameMoment, 12, 9))).toBe('accepted')
    expect(decideProgress(stored, at(sameMoment, 13, 0))).toBe('accepted')
  })
})

describe('re-basing the client clock', () => {
  it('reads an age as an interval before the server clock, never a client timestamp', () => {
    const now = T('2026-09-05T12:00:00Z')
    expect(observedAtFrom(now, 3 * 3600_000).toISOString()).toBe('2026-09-05T09:00:00.000Z')
    expect(observedAtFrom(now, 0)).toEqual(now)
  })

  it('treats nonsense as "right now" rather than trusting it', () => {
    const now = T('2026-09-05T12:00:00Z')
    expect(observedAtFrom(now, -5)).toEqual(now)
    expect(observedAtFrom(now, Number.NaN)).toEqual(now)
    expect(observedAtFrom(now, undefined)).toEqual(now)
  })

  it('clamps an absurd age instead of dating a position to 1970', () => {
    const now = T('2026-09-05T12:00:00Z')
    const clamped = observedAtFrom(now, Number.MAX_SAFE_INTEGER)
    expect(clamped.getTime()).toBe(now.getTime() - 30 * 24 * 3600_000)
  })
})

describe('two devices disagreeing (the bug this exists for)', () => {
  it('refuses the phone that was offline and keeps the laptop position', async () => {
    // Phone reads chapter 10 in the morning, offline, and cannot flush.
    // Laptop reads chapter 12 at lunch and does.
    const laptop = await write(ids.ch12, 12, 1, LUNCH)
    expect(laptop.decision).toBe('accepted')

    // The phone reconnects in the evening and finally sends its morning position.
    const phone = await write(ids.ch10, 10, 4, MORNING)
    expect(phone.decision).toBe('stale')
    expect(phone.winner.chapterId).toBe(ids.ch12)
    expect(phone.winner.pageIdx).toBe(1)

    const stored = await currentProgress(db, ids.reader, ids.series)
    expect(stored?.chapterId).toBe(ids.ch12)
    expect(stored?.pageIdx).toBe(1)
    expect(stored?.readAt.toISOString()).toBe(LUNCH.toISOString())
  })

  it('still records the stale write in the history — that chapter really was read', async () => {
    await write(ids.ch12, 12, 1, LUNCH)
    await write(ids.ch10, 10, 4, MORNING)
    const reads = await db
      .select({ chapterId: chapterReads.chapterId, readAt: chapterReads.readAt })
      .from(chapterReads)
      .where(eq(chapterReads.userId, ids.reader))
    expect(reads.map((r) => r.chapterId).sort()).toEqual([ids.ch10, ids.ch12].sort())
  })

  it('never moves a chapter_reads timestamp backwards', async () => {
    await write(ids.ch10, 10, 4, EVENING)
    await write(ids.ch10, 10, 2, MORNING)
    const [read] = await db
      .select({ readAt: chapterReads.readAt })
      .from(chapterReads)
      .where(and(eq(chapterReads.userId, ids.reader), eq(chapterReads.chapterId, ids.ch10)))
    expect(read?.readAt.toISOString()).toBe(EVENING.toISOString())
  })

  it('lets the phone win once the reader actually picks it up again', async () => {
    await write(ids.ch12, 12, 1, LUNCH)
    const laterOnThePhone = await write(ids.ch10, 10, 5, EVENING)
    expect(laterOnThePhone.decision).toBe('accepted')
    const stored = await currentProgress(db, ids.reader, ids.series)
    expect(stored?.chapterId).toBe(ids.ch10)
    expect(stored?.pageIdx).toBe(5)
  })

  it('keeps the further page when two writes describe the same moment', async () => {
    await write(ids.ch11, 11, 9, LUNCH)
    const behind = await write(ids.ch11, 11, 2, new Date(LUNCH.getTime() + 1000))
    expect(behind.decision).toBe('behind')
    expect((await currentProgress(db, ids.reader, ids.series))?.pageIdx).toBe(9)
  })

  it("keeps each account's pointer to itself", async () => {
    await write(ids.ch12, 12, 1, LUNCH)
    const stranger = await write(ids.ch10, 10, 4, MORNING, ids.other)
    expect(stranger.decision).toBe('accepted')
    expect((await currentProgress(db, ids.reader, ids.series))?.chapterId).toBe(ids.ch12)
    expect((await currentProgress(db, ids.other, ids.series))?.chapterId).toBe(ids.ch10)
  })
})

describe('merging a signed-out device into an account', () => {
  const local = (chapterId: number, pageIdx: number, observedAt: Date) => ({
    chapterId,
    pageIdx,
    scrollPct: 0,
    observedAt,
  })

  it('brings every chapter the device read into the history', async () => {
    const outcome = await mergeLocalProgress(db, ids.reader, [
      local(ids.ch10, 4, MORNING),
      local(ids.ch11, 2, LUNCH),
    ])
    expect(outcome).toMatchObject({ read: 2, advanced: 1, kept: 0, skipped: 0 })
    const reads = await db
      .select({ chapterId: chapterReads.chapterId })
      .from(chapterReads)
      .where(eq(chapterReads.userId, ids.reader))
    expect(reads.map((r) => r.chapterId).sort()).toEqual([ids.ch10, ids.ch11].sort())
  })

  it('resumes at the most recent thing the device read, not the furthest', async () => {
    await mergeLocalProgress(db, ids.reader, [
      local(ids.ch12, 1, MORNING),
      local(ids.ch10, 7, EVENING),
    ])
    const stored = await currentProgress(db, ids.reader, ids.series)
    expect(stored?.chapterId).toBe(ids.ch10)
    expect(stored?.pageIdx).toBe(7)
  })

  it('leaves the account alone where the account is the more recent of the two', async () => {
    // The account has been read on another device since this browser last saw anything.
    await write(ids.ch12, 12, 3, EVENING)
    const outcome = await mergeLocalProgress(db, ids.reader, [local(ids.ch10, 4, MORNING)])
    expect(outcome).toMatchObject({ read: 1, advanced: 0, kept: 1 })
    const stored = await currentProgress(db, ids.reader, ids.series)
    expect(stored?.chapterId).toBe(ids.ch12)
    expect(stored?.pageIdx).toBe(3)
    // …and the anonymous reading is still in the history, which is the point of merging.
    const reads = await db
      .select({ chapterId: chapterReads.chapterId })
      .from(chapterReads)
      .where(eq(chapterReads.userId, ids.reader))
    expect(reads.map((r) => r.chapterId).sort()).toEqual([ids.ch10, ids.ch12].sort())
  })

  it('moves the account forward where the device is the more recent one', async () => {
    await write(ids.ch10, 10, 1, MORNING)
    const outcome = await mergeLocalProgress(db, ids.reader, [local(ids.ch12, 6, EVENING)])
    expect(outcome).toMatchObject({ advanced: 1, kept: 0 })
    expect((await currentProgress(db, ids.reader, ids.series))?.chapterId).toBe(ids.ch12)
  })

  it('is idempotent — a retried or double-fired merge changes nothing', async () => {
    const positions = [local(ids.ch10, 4, MORNING), local(ids.ch12, 2, LUNCH)]
    const first = await mergeLocalProgress(db, ids.reader, positions)
    const second = await mergeLocalProgress(db, ids.reader, positions)
    expect(second).toEqual(first)
    const rows = await db
      .select({ chapterId: chapterReads.chapterId })
      .from(chapterReads)
      .where(eq(chapterReads.userId, ids.reader))
    expect(rows).toHaveLength(2)
  })

  it("skips chapters that are gone, unpublished, or not this viewer's to read", async () => {
    const outcome = await mergeLocalProgress(
      db,
      ids.reader,
      [
        local(ids.gone, 1, LUNCH),
        local(ids.unpublished, 1, LUNCH),
        local(ids.ch11, 1, LUNCH),
        local(ids.ch12, 1, LUNCH),
      ],
      (c) => c.id !== ids.ch12, // e.g. a chapter that has gone Premium since
    )
    expect(outcome).toMatchObject({ read: 1, advanced: 1, skipped: 3 })
    expect((await currentProgress(db, ids.reader, ids.series))?.chapterId).toBe(ids.ch11)
  })

  it('takes the newest of two local records for the same chapter', async () => {
    await mergeLocalProgress(db, ids.reader, [
      local(ids.ch11, 1, MORNING),
      local(ids.ch11, 8, EVENING),
    ])
    expect((await currentProgress(db, ids.reader, ids.series))?.pageIdx).toBe(8)
  })

  it('does nothing at all when the device has nothing to offer', async () => {
    expect(await mergeLocalProgress(db, ids.reader, [])).toEqual({
      read: 0,
      advanced: 0,
      kept: 0,
      skipped: 0,
    })
  })
})
