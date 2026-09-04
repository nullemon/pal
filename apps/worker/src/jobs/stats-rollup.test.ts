import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { shiftBucket, type ViewHit, viewerKey } from '@palscans/core'
import { MemoryQueue } from '@palscans/core/queue'
import {
  chapters,
  createDb,
  type Db,
  type DbHandle,
  ensureViewPartitions,
  executeRows,
  listViewPartitions,
  recordViewEvents,
  runMigrations,
  series,
  seriesStatsDaily,
} from '@palscans/db'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetRetentionClock, runStatsRollup } from './stats-rollup.js'

/**
 * `stats.rollup` end to end against a real Postgres (PGlite): the job the worker runs every
 * couple of minutes, plus the producer/handler contract it goes through.
 */

const SECRET = 'worker-rollup-secret'
const TODAY = new Date().toISOString().slice(0, 10)

let dir: string
let handle: DbHandle
let db: Db
let seriesId = 0
let chapterId = 0

const partition = (bucket: string) => `view_events_${bucket.replaceAll('-', '')}`

const hit = (bucket: string, who: string, chapter = chapterId): ViewHit => ({
  seriesId,
  chapterId: chapter,
  bucket,
  viewerKey: viewerKey({ bucket, ip: who, userAgent: 'Firefox' }, SECRET),
})

const viewCount = async (): Promise<number> => {
  const [row] = await db.select({ n: series.viewCount }).from(series).where(eq(series.id, seriesId))
  return Number(row?.n ?? 0)
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-rollup-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  const [s] = await db
    .insert(series)
    .values({ slug: 'rollup', title: 'Rollup', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  seriesId = s?.id ?? 0
  const [c] = await db
    .insert(chapters)
    .values({ seriesId, number: 1, state: 'published', publishedAt: new Date() })
    .returning({ id: chapters.id })
  chapterId = c?.id ?? 0
}, 120_000)

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

describe('runStatsRollup', () => {
  it('keeps tomorrow ready, rolls today up, and adds only the new views', async () => {
    resetRetentionClock()
    await recordViewEvents(db, [hit(TODAY, 'a'), hit(TODAY, 'b'), hit(TODAY, 'c', 0)])

    const first = await runStatsRollup(db, { now: new Date() })
    // today, tomorrow and the day after, so a view always has a dated partition to land in
    expect(first.created).toEqual([
      partition(TODAY),
      partition(shiftBucket(TODAY, 1)),
      partition(shiftBucket(TODAY, 2)),
    ])
    expect(first.rollup.seriesDelta).toBe(3)
    expect(await viewCount()).toBe(3)

    // a pass with nothing new is a no-op
    const second = await runStatsRollup(db, { now: new Date() })
    expect(second.rollup.seriesDelta).toBe(0)
    expect(await viewCount()).toBe(3)

    // one more reader arrives; only that one is added
    await recordViewEvents(db, [hit(TODAY, 'd')])
    const third = await runStatsRollup(db, { now: new Date() })
    expect(third.rollup.seriesDelta).toBe(1)
    expect(await viewCount()).toBe(4)

    const [daily] = await db
      .select({ views: seriesStatsDaily.views })
      .from(seriesStatsDaily)
      .where(eq(seriesStatsDaily.bucket, TODAY))
    expect(daily?.views).toBe(4)
  }, 120_000)

  it('drops partitions past the retention window, once per sweep interval', async () => {
    const old = shiftBucket(TODAY, -120)
    await ensureViewPartitions(db, { from: old, days: 0 })
    await recordViewEvents(db, [hit(old, 'ancient')])

    // the sweep is throttled: the pass above already ran it, so this one skips
    const skipped = await runStatsRollup(db, { now: new Date() })
    expect(skipped.dropped).toEqual([])
    expect(await listViewPartitions(db)).toContain(partition(old))

    resetRetentionClock()
    const swept = await runStatsRollup(db, { now: new Date() })
    expect(swept.dropped).toEqual([partition(old)])
    expect(await listViewPartitions(db)).not.toContain(partition(old))
    // and the day's rows went with the partition
    const [left] = await executeRows<{ n: string }>(
      db,
      sql`select count(*) as n from view_events where bucket = ${old}::date`,
    )
    expect(Number(left?.n)).toBe(0)
  }, 120_000)

  it('accepts a wider window for a backfill', async () => {
    resetRetentionClock()
    const older = shiftBucket(TODAY, -10)
    await recordViewEvents(db, [hit(older, 'a'), hit(older, 'b')])
    // the default window (yesterday → today) does not see it
    const narrow = await runStatsRollup(db, { now: new Date() })
    expect(narrow.rollup.seriesDelta).toBe(0)
    // asking for it explicitly does
    const wide = await runStatsRollup(db, { from: older, to: TODAY })
    expect(wide.rollup.seriesDelta).toBe(2)
  }, 120_000)
})

describe('the queue contract', () => {
  it('runs when the job is delivered, the way apps/worker wires it', async () => {
    resetRetentionClock()
    const queue = new MemoryQueue('rollup-test')
    queue.process('stats.rollup', async (job) => {
      await runStatsRollup(db, { from: job.data?.from, to: job.data?.to })
    })
    const before = await viewCount()
    await recordViewEvents(db, [hit(TODAY, 'queued-reader')])
    await queue.add('stats.rollup', {}, { jobId: 'stats.rollup:1' })
    // a duplicate delivery in the same window collapses, and would be harmless anyway
    await queue.add('stats.rollup', {}, { jobId: 'stats.rollup:1' })
    await queue.drain()
    expect(queue.failures).toEqual([])
    expect(await viewCount()).toBe(before + 1)
    await queue.close()
  }, 120_000)
})
