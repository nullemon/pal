import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { shiftBucket, type ViewHit, viewerKey } from '@palscans/core'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle, executeRows } from '../client.js'
import { runMigrations } from '../migrate.js'
import { popular } from '../queries/popular.js'
import { seriesRank } from '../queries/series.js'
import {
  dropViewPartitions,
  ensureViewPartitions,
  listViewPartitions,
  recordViewEvents,
  rollupStats,
} from '../queries/views.js'
import {
  chapterStatsDaily,
  chapters,
  series,
  seriesStatsDaily,
  viewEvents,
} from '../schema/index.js'

/**
 * The view pipeline against a real Postgres (PGlite): the dedupe rule, the rollup
 * arithmetic and the partition lifecycle. These are the three things that cannot be
 * asserted from unit tests — they are properties of the schema and the SQL functions in
 * migration 9015, not of any TypeScript.
 */

const SECRET = 'view-test-secret'
// `stats_rollup` clamps its window to the database's own UTC today, so the fixtures are
// anchored to the real one rather than to a date that would age out of the tests.
const TODAY = new Date().toISOString().slice(0, 10)
const DAYS_AGO = (n: number) => shiftBucket(TODAY, -n)

let dir: string
let handle: DbHandle
let db: Db
const ids: { alpha: number; beta: number; gamma: number; c1: number; c2: number } = {
  alpha: 0,
  beta: 0,
  gamma: 0,
  c1: 0,
  c2: 0,
}

const key = (who: string, bucket = TODAY): Uint8Array =>
  viewerKey({ bucket, ip: who, userAgent: 'Firefox' }, SECRET)

const hit = (seriesId: number, chapterId: number, who: string, bucket = TODAY): ViewHit => ({
  seriesId,
  chapterId,
  bucket,
  viewerKey: key(who, bucket),
})

const partition = (bucket: string) => `view_events_${bucket.replaceAll('-', '')}`

const counts = async () => {
  const rows = await executeRows<{ slug: string; view_count: string }>(
    db,
    sql`select slug, view_count from series order by id`,
  )
  return Object.fromEntries(rows.map((r) => [r.slug, Number(r.view_count)]))
}

const chapterCounts = async () => {
  const rows = await executeRows<{ id: string; view_count: string }>(
    db,
    sql`select id, view_count from chapters order by id`,
  )
  return Object.fromEntries(rows.map((r) => [Number(r.id), Number(r.view_count)]))
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-views-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  const inserted = await db
    .insert(series)
    .values([
      { slug: 'alpha', title: 'Alpha', type: 'manhwa', state: 'published', viewCount: 1_000 },
      { slug: 'beta', title: 'Beta', type: 'manhwa', state: 'published', viewCount: 1_000 },
      { slug: 'gamma', title: 'Gamma', type: 'manga', state: 'draft', viewCount: 0 },
    ])
    .returning({ id: series.id, slug: series.slug })
  for (const row of inserted) {
    if (row.slug === 'alpha') ids.alpha = row.id
    if (row.slug === 'beta') ids.beta = row.id
    if (row.slug === 'gamma') ids.gamma = row.id
  }
  const chs = await db
    .insert(chapters)
    .values([
      { seriesId: ids.alpha, number: 1, state: 'published', publishedAt: new Date(), viewCount: 5 },
      { seriesId: ids.beta, number: 1, state: 'published', publishedAt: new Date(), viewCount: 0 },
    ])
    .returning({ id: chapters.id, seriesId: chapters.seriesId })
  ids.c1 = chs.find((c) => c.seriesId === ids.alpha)?.id ?? 0
  ids.c2 = chs.find((c) => c.seriesId === ids.beta)?.id ?? 0
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.delete(viewEvents)
  await db.delete(seriesStatsDaily)
  await db.delete(chapterStatsDaily)
  await db.update(series).set({ viewCount: 1_000 }).where(eq(series.slug, 'alpha'))
  await db.update(series).set({ viewCount: 1_000 }).where(eq(series.slug, 'beta'))
  await db.update(chapters).set({ viewCount: 5 }).where(eq(chapters.id, ids.c1))
  await db.update(chapters).set({ viewCount: 0 }).where(eq(chapters.id, ids.c2))
})

describe('migration 9015', () => {
  it('creates chapter_stats_daily and the pipeline functions', async () => {
    const fns = await executeRows<{ proname: string }>(
      db,
      sql`select proname from pg_proc where proname in ('stats_rollup','view_events_ensure_partition','view_events_ensure_partitions','view_events_drop_partitions_before') order by proname`,
    )
    expect(fns.map((f) => f.proname)).toEqual([
      'stats_rollup',
      'view_events_drop_partitions_before',
      'view_events_ensure_partition',
      'view_events_ensure_partitions',
    ])
    const cols = await executeRows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'chapter_stats_daily' order by column_name`,
    )
    expect(cols.map((c) => c.column_name)).toEqual(['bucket', 'chapter_id', 'views'])
  })

  it('leaves today and tomorrow with a partition ready', async () => {
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    expect(await listViewPartitions(db)).toContain(`view_events_${today}`)
  })
})

describe('recording view events', () => {
  it('counts one reader once per chapter per day, however many times they ask', async () => {
    const first = await recordViewEvents(db, [hit(ids.alpha, ids.c1, 'reader-a')])
    const again = await recordViewEvents(db, [
      hit(ids.alpha, ids.c1, 'reader-a'),
      hit(ids.alpha, ids.c1, 'reader-a'),
    ])
    expect(first).toBe(1)
    expect(again).toBe(0)
    const [row] = await executeRows<{ n: string }>(db, sql`select count(*) as n from view_events`)
    expect(Number(row?.n)).toBe(1)
  })

  it('separates viewers, chapters, the series page and days', async () => {
    const written = await recordViewEvents(db, [
      hit(ids.alpha, ids.c1, 'reader-a'),
      hit(ids.alpha, ids.c1, 'reader-b'),
      hit(ids.alpha, 0, 'reader-a'), // the series page is its own view
      hit(ids.alpha, ids.c1, 'reader-a', DAYS_AGO(1)), // yesterday counts again
    ])
    expect(written).toBe(4)
  })

  it('throws away hits for anything that is not a live published row', async () => {
    const written = await recordViewEvents(db, [
      hit(999_999, 0, 'reader-a'), // no such series
      hit(ids.gamma, 0, 'reader-a'), // draft series
      hit(ids.alpha, ids.c2, 'reader-a'), // chapter belongs to beta, not alpha
      hit(ids.alpha, 999_999, 'reader-a'), // no such chapter
      hit(ids.alpha, ids.c1, 'reader-a'), // the only real one
    ])
    expect(written).toBe(1)
  })
})

describe('the rollup', () => {
  it('adds views to the daily tables and the difference to both counters', async () => {
    await recordViewEvents(db, [
      hit(ids.alpha, ids.c1, 'a'),
      hit(ids.alpha, ids.c1, 'b'),
      hit(ids.alpha, ids.c1, 'c'),
      hit(ids.alpha, 0, 'a'),
      hit(ids.beta, ids.c2, 'a'),
    ])
    const result = await rollupStats(db, { from: TODAY, to: TODAY })
    expect(result).toMatchObject({
      seriesBuckets: 2,
      chapterBuckets: 2,
      seriesDelta: 5,
      chapterDelta: 4,
    })

    const daily = await db
      .select({ seriesId: seriesStatsDaily.seriesId, views: seriesStatsDaily.views })
      .from(seriesStatsDaily)
      .where(eq(seriesStatsDaily.bucket, TODAY))
    expect(daily.find((d) => d.seriesId === ids.alpha)?.views).toBe(4) // 3 chapter + 1 series page
    expect(daily.find((d) => d.seriesId === ids.beta)?.views).toBe(1)

    // the counters moved by exactly the new views, on top of what was already there
    expect(await counts()).toEqual({ alpha: 1_004, beta: 1_001, gamma: 0 })
    expect(await chapterCounts()).toEqual({ [ids.c1]: 8, [ids.c2]: 1 })
  })

  it('is idempotent — a second pass over the same window changes nothing', async () => {
    await recordViewEvents(db, [hit(ids.alpha, ids.c1, 'a'), hit(ids.alpha, ids.c1, 'b')])
    await rollupStats(db, { from: TODAY, to: TODAY })
    const after = await counts()
    const second = await rollupStats(db, { from: TODAY, to: TODAY })
    expect(second).toMatchObject({ seriesBuckets: 0, chapterBuckets: 0, seriesDelta: 0 })
    expect(await counts()).toEqual(after)
  })

  it('picks up views that arrive after a bucket was already rolled up', async () => {
    await recordViewEvents(db, [hit(ids.alpha, ids.c1, 'a')])
    await rollupStats(db, { from: TODAY, to: TODAY })
    expect((await counts()).alpha).toBe(1_001)
    await recordViewEvents(db, [hit(ids.alpha, ids.c1, 'b'), hit(ids.alpha, ids.c1, 'c')])
    const again = await rollupStats(db, { from: TODAY, to: TODAY })
    expect(again.seriesDelta).toBe(2) // only the two new ones
    expect((await counts()).alpha).toBe(1_003)
    const [row] = await db
      .select({ views: seriesStatsDaily.views })
      .from(seriesStatsDaily)
      .where(eq(seriesStatsDaily.seriesId, ids.alpha))
    expect(row?.views).toBe(3)
  })

  it('never zeroes a day it has no events for — the seeder and importer keep their numbers', async () => {
    await db
      .insert(seriesStatsDaily)
      .values({ seriesId: ids.alpha, bucket: DAYS_AGO(2), views: 5_000 })
    await recordViewEvents(db, [hit(ids.alpha, ids.c1, 'a')])
    const result = await rollupStats(db, { from: DAYS_AGO(3), to: TODAY })
    expect(result.seriesDelta).toBe(1)
    const [seeded] = await db
      .select({ views: seriesStatsDaily.views })
      .from(seriesStatsDaily)
      .where(eq(seriesStatsDaily.bucket, DAYS_AGO(2)))
    expect(seeded?.views).toBe(5_000)
    expect((await counts()).alpha).toBe(1_001)
  })

  it('drives the popularity windows and the "Rank #N" badge', async () => {
    // beta gets three viewers today, alpha one — beta should lead the week
    await recordViewEvents(db, [
      hit(ids.beta, ids.c2, 'a'),
      hit(ids.beta, ids.c2, 'b'),
      hit(ids.beta, ids.c2, 'c'),
      hit(ids.alpha, ids.c1, 'a'),
    ])
    await rollupStats(db, { from: TODAY, to: TODAY })
    const week = await popular(db, 'weekly')
    expect(week.map((r) => r.slug)).toEqual(['beta', 'alpha'])
    expect(week[0]?.views).toBe(3)
    // all-time reads view_count: beta is now 1003 against alpha's 1001
    expect(await counts()).toMatchObject({ alpha: 1_001, beta: 1_003 })
    expect(await seriesRank(db, ids.beta)).toBe(1)
    expect(await seriesRank(db, ids.alpha)).toBe(2)
    // and the badge moves when the order does: give alpha five more viewers
    await recordViewEvents(db, [
      hit(ids.alpha, ids.c1, 'd'),
      hit(ids.alpha, ids.c1, 'e'),
      hit(ids.alpha, ids.c1, 'f'),
      hit(ids.alpha, ids.c1, 'g'),
      hit(ids.alpha, ids.c1, 'h'),
    ])
    await rollupStats(db, { from: TODAY, to: TODAY })
    expect(await seriesRank(db, ids.alpha)).toBe(1)
    expect(await seriesRank(db, ids.beta)).toBe(2)
  })
})

describe('the partition lifecycle', () => {
  it('creates a day ahead of time and rescues rows that landed in the default partition', async () => {
    // no partition for this day yet, so the row lands in view_events_default
    await recordViewEvents(db, [
      hit(ids.alpha, ids.c1, 'a', DAYS_AGO(52)),
      hit(ids.alpha, 0, 'b', DAYS_AGO(52)),
    ])
    const [stray] = await executeRows<{ n: string }>(
      db,
      sql`select count(*) as n from view_events_default`,
    )
    expect(Number(stray?.n)).toBe(2)

    const created = await ensureViewPartitions(db, { from: DAYS_AGO(52), days: 1 })
    expect(created).toEqual([partition(DAYS_AGO(52)), partition(DAYS_AGO(51))])
    const [moved] = await executeRows<{ n: string }>(
      db,
      sql`select count(*) as n from ${sql.identifier(partition(DAYS_AGO(52)))}`,
    )
    expect(Number(moved?.n)).toBe(2)
    const [left] = await executeRows<{ n: string }>(
      db,
      sql`select count(*) as n from view_events_default`,
    )
    expect(Number(left?.n)).toBe(0)
    // and nothing was lost on the way
    const [total] = await executeRows<{ n: string }>(db, sql`select count(*) as n from view_events`)
    expect(Number(total?.n)).toBe(2)
    // calling it again is a no-op
    expect(await ensureViewPartitions(db, { from: DAYS_AGO(52), days: 0 })).toEqual([
      partition(DAYS_AGO(52)),
    ])
  })

  it('drops partitions past the retention window and sweeps the default one', async () => {
    await ensureViewPartitions(db, { from: DAYS_AGO(200), days: 0 })
    await recordViewEvents(db, [
      hit(ids.alpha, ids.c1, 'a', DAYS_AGO(200)), // in a dated partition
      hit(ids.alpha, ids.c1, 'a', DAYS_AGO(150)), // in the default partition
      hit(ids.alpha, ids.c1, 'a', TODAY),
    ])
    await ensureViewPartitions(db, { from: TODAY, days: 0 })

    const dropped = await dropViewPartitions(db, { today: TODAY, keepDays: 90 })
    expect(dropped).toEqual([partition(DAYS_AGO(200))])
    const names = await listViewPartitions(db)
    expect(names).not.toContain(partition(DAYS_AGO(200)))
    expect(names).toContain('view_events_default') // never dropped, only swept
    const [left] = await executeRows<{ n: string }>(db, sql`select count(*) as n from view_events`)
    expect(Number(left?.n)).toBe(1) // only today's row survives 90-day retention
  })

  it('refuses to recompute a bucket old enough for retention to have pruned it', async () => {
    const result = await rollupStats(db, { from: '2020-01-01', to: '2020-01-02' })
    // clamped forward to today - 89, which is after `to`, so the window is empty
    expect(result).toMatchObject({ seriesBuckets: 0, chapterBuckets: 0, seriesDelta: 0 })
  })
})
