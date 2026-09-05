import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle } from '../client.js'
import { runMigrations } from '../migrate.js'
import {
  bookmarks,
  chapterReads,
  chapters,
  ratings,
  readingProgress,
  series,
  users,
} from '../schema/index.js'
import { monthWindow, readingStats, streaks } from './stats.js'

/**
 * Reading stats: the arithmetic on real rows. The clock is injected, so the month window
 * and the streak are deterministic rather than "whatever today happens to be".
 */

let dir: string
let handle: DbHandle
let db: Db
const ids = { reader: 0, other: 0, alpha: 0, beta: 0, gone: 0 }
const chapterIds: Record<string, number[]> = { alpha: [], beta: [], gone: [] }

const NOW = new Date('2026-06-15T12:00:00Z')

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-stats-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  const people = await db
    .insert(users)
    .values([
      { email: 'reader@example.com', username: 'reader' },
      { email: 'other@example.com', username: 'other2' },
    ])
    .returning({ id: users.id, username: users.username })
  ids.reader = people.find((u) => u.username === 'reader')?.id ?? 0
  ids.other = people.find((u) => u.username === 'other2')?.id ?? 0
  const titles = await db
    .insert(series)
    .values([
      { slug: 'alpha', title: 'Alpha', type: 'manhwa', state: 'published' },
      { slug: 'beta', title: 'Beta', type: 'manga', state: 'published' },
      { slug: 'gone', title: 'Gone', type: 'manga', state: 'published', deletedAt: NOW },
    ])
    .returning({ id: series.id, slug: series.slug })
  for (const row of titles) {
    if (row.slug === 'alpha') ids.alpha = row.id
    if (row.slug === 'beta') ids.beta = row.id
    if (row.slug === 'gone') ids.gone = row.id
  }
  for (const [slug, seriesId] of [
    ['alpha', ids.alpha],
    ['beta', ids.beta],
    ['gone', ids.gone],
  ] as const) {
    const rows = await db
      .insert(chapters)
      .values(
        Array.from({ length: 6 }, (_, i) => ({
          seriesId,
          number: i + 1,
          state: 'published' as const,
          publishedAt: NOW,
        })),
      )
      .returning({ id: chapters.id })
    chapterIds[slug] = rows.map((r) => r.id)
  }
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.delete(chapterReads)
  await db.delete(bookmarks)
  await db.delete(ratings)
  await db.delete(readingProgress)
})

const read = (slug: keyof typeof chapterIds, index: number, at: string, userId = ids.reader) => ({
  userId,
  chapterId: chapterIds[slug]?.[index] ?? 0,
  readAt: new Date(at),
})

describe('streaks', () => {
  it('counts the longest run of consecutive days', () => {
    expect(streaks(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-09'], '2026-06-15')).toEqual(
      { current: 0, longest: 3 },
    )
  })

  it('counts a run that reaches today, and forgives today not having started', () => {
    expect(streaks(['2026-06-13', '2026-06-14', '2026-06-15'], '2026-06-15')).toEqual({
      current: 3,
      longest: 3,
    })
    expect(streaks(['2026-06-13', '2026-06-14'], '2026-06-15')).toEqual({
      current: 2,
      longest: 2,
    })
    expect(streaks(['2026-06-13'], '2026-06-15')).toEqual({ current: 0, longest: 1 })
  })

  it('ignores duplicates and order, and has no streak with no days', () => {
    expect(streaks(['2026-06-15', '2026-06-14', '2026-06-15'], '2026-06-15')).toEqual({
      current: 2,
      longest: 2,
    })
    expect(streaks([], '2026-06-15')).toEqual({ current: 0, longest: 0 })
  })

  it('crosses a month and a leap-year boundary', () => {
    expect(streaks(['2026-05-31', '2026-06-01'], '2026-06-01')).toEqual({
      current: 2,
      longest: 2,
    })
    expect(streaks(['2028-02-28', '2028-02-29', '2028-03-01'], '2028-03-01')).toEqual({
      current: 3,
      longest: 3,
    })
  })
})

describe('monthWindow', () => {
  it('ends on the month of `now` and walks back across the year boundary', () => {
    expect(monthWindow(new Date('2026-02-10T00:00:00Z'), 4)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })
})

describe('readingStats', () => {
  it('counts only this reader, and only live series', async () => {
    await db.insert(chapterReads).values([
      read('alpha', 0, '2026-06-15T08:00:00Z'),
      read('alpha', 1, '2026-06-15T09:00:00Z'),
      read('beta', 0, '2026-06-14T09:00:00Z'),
      // another reader's row, and a read on a removed series: neither may count
      read('alpha', 2, '2026-06-15T10:00:00Z', ids.other),
      read('gone', 0, '2026-06-15T10:00:00Z'),
    ])
    const stats = await readingStats(db, ids.reader, { now: NOW })
    expect(stats.chaptersRead).toBe(3)
    expect(stats.seriesRead).toBe(2)
    expect(stats.daysRead).toBe(2)
    expect(stats.currentStreak).toBe(2)
    expect(stats.longestStreak).toBe(2)
    expect(stats.firstReadAt?.toISOString()).toBe('2026-06-14T09:00:00.000Z')
    expect(stats.lastReadAt?.toISOString()).toBe('2026-06-15T09:00:00.000Z')
  })

  it('buckets the last twelve months in UTC, zeroes included', async () => {
    await db.insert(chapterReads).values([
      read('alpha', 0, '2026-06-15T08:00:00Z'),
      read('alpha', 1, '2026-04-02T08:00:00Z'),
      read('alpha', 2, '2026-04-03T08:00:00Z'),
      // just outside the window (13 months back) — must not appear at all
      read('beta', 0, '2025-05-02T08:00:00Z'),
    ])
    const stats = await readingStats(db, ids.reader, { now: NOW })
    expect(stats.months).toHaveLength(12)
    expect(stats.months.at(0)?.month).toBe('2025-07')
    expect(stats.months.at(-1)).toEqual({ month: '2026-06', chapters: 1 })
    expect(stats.months.find((m) => m.month === '2026-04')?.chapters).toBe(2)
    expect(stats.months.find((m) => m.month === '2026-05')?.chapters).toBe(0)
    // the 2025-05 read is still in the all-time total
    expect(stats.chaptersRead).toBe(4)
  })

  it('ranks the most-read series', async () => {
    await db
      .insert(chapterReads)
      .values([
        read('beta', 0, '2026-06-10T08:00:00Z'),
        read('beta', 1, '2026-06-10T09:00:00Z'),
        read('beta', 2, '2026-06-10T10:00:00Z'),
        read('alpha', 0, '2026-06-11T08:00:00Z'),
      ])
    const stats = await readingStats(db, ids.reader, { now: NOW })
    expect(stats.topSeries.map((s) => [s.slug, s.chaptersRead])).toEqual([
      ['beta', 3],
      ['alpha', 1],
    ])
  })

  it('counts shelves, ratings and series in progress', async () => {
    await db.insert(bookmarks).values([
      { userId: ids.reader, seriesId: ids.alpha, status: 'reading' },
      { userId: ids.reader, seriesId: ids.beta, status: 'completed' },
      { userId: ids.reader, seriesId: ids.gone, status: 'reading' },
      { userId: ids.other, seriesId: ids.alpha, status: 'reading' },
    ])
    await db.insert(ratings).values([
      { userId: ids.reader, seriesId: ids.alpha, score: 8 },
      { userId: ids.reader, seriesId: ids.beta, score: 9 },
    ])
    await db.insert(readingProgress).values([
      {
        userId: ids.reader,
        seriesId: ids.alpha,
        chapterId: chapterIds.alpha?.[0] ?? 0,
      },
    ])
    const stats = await readingStats(db, ids.reader, { now: NOW })
    expect(stats.seriesFollowed).toBe(2) // the removed series is not one of them
    expect(stats.seriesCompleted).toBe(1)
    expect(stats.ratingsGiven).toBe(2)
    expect(stats.averageRating).toBe(8.5)
    expect(stats.inProgress).toBe(1)
  })

  it('is all zeroes for an account that has read nothing', async () => {
    const stats = await readingStats(db, ids.reader, { now: NOW })
    expect(stats.chaptersRead).toBe(0)
    expect(stats.currentStreak).toBe(0)
    expect(stats.averageRating).toBeNull()
    expect(stats.firstReadAt).toBeNull()
    expect(stats.topSeries).toEqual([])
    expect(stats.months.every((m) => m.chapters === 0)).toBe(true)
  })
})
