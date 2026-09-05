import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { shiftBucket } from '@palscans/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle } from '../client.js'
import { runMigrations } from '../migrate.js'
import {
  ANALYTICS_WINDOWS,
  analyticsWindow,
  bucketsInRange,
  DEFAULT_ANALYTICS_WINDOW,
  denseDays,
  parseAnalyticsWindow,
  topChaptersByViews,
  topSeriesByViews,
  viewsByDay,
  viewTotals,
} from '../queries/analytics.js'
import { chapterStatsDaily, chapters, series, seriesStatsDaily } from '../schema/index.js'

/**
 * The admin analytics queries (docs/13). Two halves: the window arithmetic, which is pure
 * and asserted against fixed dates, and the aggregation itself against a real Postgres
 * (PGlite) — the part that has to agree with what the rollup actually writes.
 */

// The window helpers clamp to the database's own UTC today, so fixtures are anchored to the
// real one rather than to a date that would age out of the suite.
const TODAY = new Date().toISOString().slice(0, 10)
const DAYS_AGO = (n: number) => shiftBucket(TODAY, -n)

let dir: string
let handle: DbHandle
let db: Db
const ids = { alpha: 0, beta: 0, gone: 0, c1: 0, c2: 0, cGone: 0 }

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-analytics-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  const inserted = await db
    .insert(series)
    .values([
      { slug: 'alpha', title: 'Alpha', type: 'manhwa', state: 'published', viewCount: 900 },
      { slug: 'beta', title: 'Beta', type: 'manga', state: 'published', viewCount: 100 },
      {
        slug: 'gone',
        title: 'Gone',
        type: 'manga',
        state: 'removed',
        viewCount: 7,
        deletedAt: new Date(),
      },
    ])
    .returning({ id: series.id, slug: series.slug })
  for (const row of inserted) ids[row.slug as 'alpha' | 'beta' | 'gone'] = row.id
  const chs = await db
    .insert(chapters)
    .values([
      { seriesId: ids.alpha, number: 1, state: 'published', publishedAt: new Date() },
      { seriesId: ids.beta, number: 2, state: 'published', publishedAt: new Date() },
      {
        seriesId: ids.alpha,
        number: 3,
        state: 'removed',
        publishedAt: new Date(),
        deletedAt: new Date(),
      },
    ])
    .returning({ id: chapters.id, number: chapters.number })
  ids.c1 = chs.find((c) => Number(c.number) === 1)?.id ?? 0
  ids.c2 = chs.find((c) => Number(c.number) === 2)?.id ?? 0
  ids.cGone = chs.find((c) => Number(c.number) === 3)?.id ?? 0
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.delete(seriesStatsDaily)
  await db.delete(chapterStatsDaily)
})

describe('window arithmetic', () => {
  it('counts today as one of the days, at both ends', () => {
    expect(analyticsWindow(7, new Date('2026-09-05T11:00:00Z'))).toEqual({
      from: '2026-08-30',
      to: '2026-09-05',
    })
    expect(analyticsWindow(1, new Date('2026-09-05T11:00:00Z'))).toEqual({
      from: '2026-09-05',
      to: '2026-09-05',
    })
    expect(analyticsWindow(90, new Date('2026-09-05T00:00:00Z')).from).toBe('2026-06-08')
  })

  it('produces exactly `days` buckets for every offered window', () => {
    for (const days of ANALYTICS_WINDOWS) {
      const range = analyticsWindow(days, new Date('2026-03-01T23:59:59Z'))
      expect(bucketsInRange(range)).toHaveLength(days)
      expect(bucketsInRange(range).at(-1)).toBe('2026-03-01')
    }
  })

  it('crosses month and year boundaries by the calendar, not by 30-day months', () => {
    // 2026 is not a leap year: 7 days back from 1 March is 23 February.
    expect(analyticsWindow(7, new Date('2026-03-01T00:00:00Z')).from).toBe('2026-02-23')
    expect(analyticsWindow(30, new Date('2026-01-05T00:00:00Z')).from).toBe('2025-12-07')
  })

  it('returns nothing for an inverted range instead of looping forever', () => {
    expect(bucketsInRange({ from: '2026-09-05', to: '2026-09-01' })).toEqual([])
  })

  it('zero-fills the days nothing was recorded on, in order', () => {
    const dense = denseDays(
      [
        { bucket: '2026-09-03', views: 12 },
        { bucket: '2026-09-01', views: 4 },
      ],
      { from: '2026-09-01', to: '2026-09-04' },
    )
    expect(dense).toEqual([
      { bucket: '2026-09-01', views: 4 },
      { bucket: '2026-09-02', views: 0 },
      { bucket: '2026-09-03', views: 12 },
      { bucket: '2026-09-04', views: 0 },
    ])
  })

  it('ignores rows outside the range it was asked for', () => {
    const dense = denseDays([{ bucket: '2026-08-31', views: 99 }], {
      from: '2026-09-01',
      to: '2026-09-02',
    })
    expect(dense.map((d) => d.views)).toEqual([0, 0])
  })

  it('takes only the windows it offers from the URL', () => {
    expect(parseAnalyticsWindow('7')).toBe(7)
    expect(parseAnalyticsWindow('90')).toBe(90)
    expect(parseAnalyticsWindow(30)).toBe(30)
    for (const bad of ['14', 'all', '', '7; drop table', undefined, null, Number.NaN, -7])
      expect(parseAnalyticsWindow(bad)).toBe(DEFAULT_ANALYTICS_WINDOW)
  })
})

describe('aggregating the daily tables', () => {
  it('sums every series into one site-wide line, with the quiet days at zero', async () => {
    await db.insert(seriesStatsDaily).values([
      { seriesId: ids.alpha, bucket: TODAY, views: 10 },
      { seriesId: ids.beta, bucket: TODAY, views: 5 },
      { seriesId: ids.alpha, bucket: DAYS_AGO(2), views: 3 },
    ])
    const days = await viewsByDay(db, analyticsWindow(4))
    expect(days).toHaveLength(4)
    expect(days.map((d) => d.views)).toEqual([0, 3, 0, 15])
    expect(days.at(-1)?.bucket).toBe(TODAY)
  })

  it('counts a deleted series in the site-wide line — the views still happened', async () => {
    await db.insert(seriesStatsDaily).values([
      { seriesId: ids.alpha, bucket: TODAY, views: 10 },
      { seriesId: ids.gone, bucket: TODAY, views: 40 },
    ])
    const [day] = await viewsByDay(db, analyticsWindow(1))
    expect(day?.views).toBe(50)
  })

  it('ranks series by views inside the window only, and leaves the trash out', async () => {
    await db.insert(seriesStatsDaily).values([
      { seriesId: ids.alpha, bucket: DAYS_AGO(20), views: 5_000 }, // outside a 7-day window
      { seriesId: ids.alpha, bucket: TODAY, views: 2 },
      { seriesId: ids.beta, bucket: DAYS_AGO(1), views: 40 },
      { seriesId: ids.gone, bucket: TODAY, views: 9_999 },
    ])
    const week = await topSeriesByViews(db, analyticsWindow(7))
    expect(week.map((r) => [r.slug, r.views])).toEqual([
      ['beta', 40],
      ['alpha', 2],
    ])
    const month = await topSeriesByViews(db, analyticsWindow(30))
    expect(month.map((r) => [r.slug, r.views])).toEqual([
      ['alpha', 5_002],
      ['beta', 40],
    ])
    // the all-time counter rides along, unaffected by the window
    expect(month[0]?.viewCount).toBe(900)
  })

  it('honours the limit', async () => {
    await db.insert(seriesStatsDaily).values([
      { seriesId: ids.alpha, bucket: TODAY, views: 2 },
      { seriesId: ids.beta, bucket: TODAY, views: 1 },
    ])
    expect(await topSeriesByViews(db, analyticsWindow(7), 1)).toHaveLength(1)
  })

  it('ranks chapters by views and names the series they belong to', async () => {
    await db.insert(chapterStatsDaily).values([
      { chapterId: ids.c1, bucket: TODAY, views: 4 },
      { chapterId: ids.c1, bucket: DAYS_AGO(3), views: 6 },
      { chapterId: ids.c2, bucket: TODAY, views: 7 },
      { chapterId: ids.cGone, bucket: TODAY, views: 500 }, // deleted chapter
    ])
    const top = await topChaptersByViews(db, analyticsWindow(30))
    expect(top.map((r) => [r.seriesTitle, r.number, r.views])).toEqual([
      ['Alpha', 1, 10],
      ['Beta', 2, 7],
    ])
    expect(top[0]?.seriesId).toBe(ids.alpha)
  })

  it('adds up today, the rolling week and the rolling month, and reads all-time off the counters', async () => {
    await db.insert(seriesStatsDaily).values([
      { seriesId: ids.alpha, bucket: TODAY, views: 10 },
      { seriesId: ids.beta, bucket: TODAY, views: 1 },
      { seriesId: ids.alpha, bucket: DAYS_AGO(6), views: 100 }, // last day inside the week
      { seriesId: ids.alpha, bucket: DAYS_AGO(7), views: 1_000 }, // first day outside it
      { seriesId: ids.alpha, bucket: DAYS_AGO(29), views: 10_000 }, // last day inside the month
      { seriesId: ids.alpha, bucket: DAYS_AGO(30), views: 100_000 }, // outside it
    ])
    const totals = await viewTotals(db)
    expect(totals.today).toBe(11)
    expect(totals.week).toBe(111)
    expect(totals.month).toBe(11_111)
    // 900 + 100; the soft-deleted series' 7 is not counted.
    expect(totals.allTime).toBe(1_000)
  })

  it('reports zeros rather than nulls when nothing has been recorded at all', async () => {
    const totals = await viewTotals(db)
    expect(totals).toEqual({ today: 0, week: 0, month: 0, allTime: 1_000 })
    expect(await topSeriesByViews(db, analyticsWindow(30))).toEqual([])
    expect(await topChaptersByViews(db, analyticsWindow(30))).toEqual([])
    expect((await viewsByDay(db, analyticsWindow(30))).every((d) => d.views === 0)).toBe(true)
  })
})
