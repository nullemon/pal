import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle } from '../client.js'
import { runMigrations } from '../migrate.js'
import {
  loadModerationMetrics,
  metricsRange,
  moderatorActivity,
  parseModerationWindow,
  queueDepths,
  reportAgeProfile,
  reportQueueFlow,
  reportTimeToAction,
  staleQueueItems,
} from './moderation-metrics.js'

/**
 * The queue numbers, against a real Postgres. `percentile_cont`, `filter (where …)` and the
 * `generate_series` day spine are all database features doing the arithmetic, so these are
 * assertions about SQL rather than about TypeScript.
 */

const NOW = new Date('2026-09-05T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

let dir: string
let handle: DbHandle
let db: Db
const ids = { mod: 0, admin: 0, reader: 0, series: 0, chapter: 0 }

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-modmetrics-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)

  const users = await db.execute(
    sql`insert into users (email, username, role) values
        ('mod@example.com','mod','moderator'),
        ('admin@example.com','admin','admin'),
        ('reader@example.com','reader','user')
        returning id, username`,
  )
  const rows = (Array.isArray(users) ? users : (users as { rows: unknown[] }).rows) as Array<{
    id: number
    username: string
  }>
  ids.mod = Number(rows.find((r) => r.username === 'mod')?.id)
  ids.admin = Number(rows.find((r) => r.username === 'admin')?.id)
  ids.reader = Number(rows.find((r) => r.username === 'reader')?.id)

  await db.execute(
    sql`insert into series (slug, title, type, state) values ('alpha','Alpha','manhwa','published')`,
  )

  // Four open reports at known ages: two inside the day, one this week, one three weeks old.
  await db.execute(sql`insert into reports (kind, target_type, target_id, reason, status, created_at) values
      ('comment','comment',1,'spam','open',${hoursAgo(2)}),
      ('comment','comment',2,'harassment','open',${hoursAgo(20)}),
      ('broken_chapter','chapter',1,'missing pages','open',${hoursAgo(72)}),
      ('dmca','series',1,'copyright','open',${hoursAgo(24 * 21)})`)

  // Six handled reports with known latencies: 1h, 2h, 3h, 4h, 5h and 40h.
  for (const [i, latency] of [1, 2, 3, 4, 5, 40].entries())
    await db.execute(sql`insert into reports (kind, target_type, target_id, reason, status, created_at, handled_by, handled_at)
        values ('comment','comment',${100 + i},'spam','actioned',${hoursAgo(48 + latency)},${ids.mod},${hoursAgo(48)})`)

  await db.execute(sql`insert into comments (user_id, series_id, body, status, created_at)
      select ${ids.reader}::bigint, s.id, '{"type":"doc","version":1,"children":[]}'::jsonb, 'pending'::comment_status, ${hoursAgo(30)}::timestamptz from series s
      union all
      select ${ids.reader}::bigint, s.id, '{"type":"doc","version":1,"children":[]}'::jsonb, 'shadow'::comment_status, ${hoursAgo(3)}::timestamptz from series s`)

  await db.execute(sql`insert into takedowns (claimant, claimant_email, notice_body, received_at) values
      ('Rights Co','legal@example.com','notice',${hoursAgo(60)})`)
  await db.execute(sql`insert into takedowns (claimant, claimant_email, notice_body, received_at, action, actioned_at) values
      ('Other Co','legal2@example.com','notice',${hoursAgo(30)},'removed',${hoursAgo(20)})`)

  await db.execute(
    sql`insert into community_images (key, width, height, status) values ('a', 10, 10, 'pending')`,
  )

  // The audit trail two staff members left: moderation work, plus admin work that must not
  // be counted as moderation.
  await db.execute(sql`insert into audit_log (actor_id, action, target_type, target_id, created_at) values
      (${ids.mod},'report.actioned','report',1,${hoursAgo(5)}),
      (${ids.mod},'report.dismiss','report',2,${hoursAgo(5)}),
      (${ids.mod},'comment.approve','comment',1,${hoursAgo(28)}),
      (${ids.mod},'comment.delete','comment',2,${hoursAgo(28)}),
      (${ids.mod},'user.ban','user',3,${hoursAgo(28)}),
      (${ids.admin},'takedown.acknowledge','takedown',1,${hoursAgo(3)}),
      (${ids.admin},'community_image.approve','community_image',1,${hoursAgo(3)}),
      (${ids.admin},'settings.layouts','settings',null,${hoursAgo(3)}),
      (${ids.admin},'appearance.publish','settings',null,${hoursAgo(3)}),
      (null,'chapter.commit','chapter',1,${hoursAgo(3)})`)
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

describe('metricsRange', () => {
  it('spans whole UTC days, oldest first, ending today', () => {
    const range = metricsRange(7, NOW)
    expect(range.buckets).toHaveLength(7)
    expect(range.buckets[0]).toBe('2026-08-30')
    expect(range.buckets.at(-1)).toBe('2026-09-05')
  })

  it('falls back rather than trusting a query string', () => {
    expect(parseModerationWindow('30')).toBe(30)
    expect(parseModerationWindow('9999')).toBe(14)
    expect(parseModerationWindow(undefined)).toBe(14)
  })
})

describe('queueDepths', () => {
  it('counts each queue the way its own screen does', async () => {
    const d = await queueDepths(db)
    expect(d.openReports).toBe(4)
    expect(d.commentsHeld).toBe(1)
    expect(d.commentsShadow).toBe(1)
    expect(d.reportedComments).toBe(2)
    expect(d.imagesPending).toBe(1)
    // "awaiting acknowledgement" is the received-and-untouched state, not every open notice.
    expect(d.takedownsUnacknowledged).toBe(1)
    expect(d.takedownsOpen).toBe(1)
  })
})

describe('reportAgeProfile', () => {
  it('bands the open queue by age and names the oldest untouched report', async () => {
    const p = await reportAgeProfile(db, NOW)
    expect(p.total).toBe(4)
    expect(p.bands.map((b) => [b.key, b.count])).toEqual([
      ['fresh', 2],
      ['aging', 1],
      ['stale', 1],
    ])
    expect(p.oldest?.kind).toBe('dmca')
    expect(Math.round((p.oldest?.ageMs ?? 0) / 3_600_000)).toBe(24 * 21)
    // The lanes are ordered by their own oldest item, so the worst lane is first.
    expect(p.byKind[0]?.kind).toBe('dmca')
  })
})

describe('reportTimeToAction', () => {
  it('reports the median and p90 of what was actually decided in the window', async () => {
    const t = await reportTimeToAction(db, metricsRange(30, NOW).from)
    expect(t.handled).toBe(6)
    // latencies 1,2,3,4,5,40 hours → median 3.5h, p90 22.5h, worst 40h
    expect(t.medianMs).toBe(3.5 * 3_600_000)
    expect(t.p90Ms).toBe(22.5 * 3_600_000)
    expect(t.worstMs).toBe(40 * 3_600_000)
  })

  it('returns nulls rather than a zero when nothing was handled', async () => {
    const t = await reportTimeToAction(db, new Date(NOW.getTime() + 86_400_000))
    expect(t.handled).toBe(0)
    expect(t.medianMs).toBeNull()
  })
})

describe('moderatorActivity', () => {
  it('counts moderation work per person and leaves admin work out of it', async () => {
    const rows = await moderatorActivity(db, metricsRange(7, NOW))
    const mod = rows.find((r) => r.username === 'mod')
    const admin = rows.find((r) => r.username === 'admin')
    expect(mod?.total).toBe(5)
    expect(mod?.reports).toBe(2)
    expect(mod?.comments).toBe(2)
    expect(mod?.users).toBe(1)
    // settings.layouts and appearance.publish are admin work, not moderation.
    expect(admin?.total).toBe(2)
    expect(admin?.takedowns).toBe(1)
    expect(admin?.comments).toBe(1)
    // A chapter commit by the system is neither.
    expect(rows.find((r) => r.actorId === null)).toBeUndefined()
    expect(rows[0]?.username).toBe('mod')
    expect(mod?.perDay).toHaveLength(7)
    expect(mod?.perDay.reduce((a, b) => a + b, 0)).toBe(5)
  })
})

describe('reportQueueFlow', () => {
  it('gives one point per day of the window, opened against resolved', async () => {
    const flow = await reportQueueFlow(db, metricsRange(7, NOW))
    expect(flow).toHaveLength(7)
    expect(flow.map((f) => f.bucket)).toEqual(metricsRange(7, NOW).buckets)
    // Nine reports were raised inside the window (three still open, six since handled); the
    // three-week-old DMCA notice was raised before it and only shows up in the open queue.
    expect(flow.reduce((t, f) => t + f.opened, 0)).toBe(9)
    expect(flow.reduce((t, f) => t + f.resolved, 0)).toBe(6)
  })
})

describe('staleQueueItems', () => {
  it('merges the three queues into one oldest-first list and marks what is late', async () => {
    const items = await staleQueueItems(db, NOW)
    expect(items[0]?.queue).toBe('report')
    expect(items[0]?.overdue).toBe(true)
    const takedown = items.find((i) => i.queue === 'takedown')
    expect(takedown?.detail).toBe('not acknowledged')
    expect(takedown?.overdue).toBe(true) // 60h against a 48h SLA
    const shadow = items.find((i) => i.queue === 'comment')
    expect(shadow?.detail).toContain('@reader')
    for (let i = 1; i < items.length; i++)
      expect(items[i - 1]?.ageMs).toBeGreaterThanOrEqual(items[i]?.ageMs ?? 0)
  })
})

describe('loadModerationMetrics', () => {
  it('assembles the whole screen in one call', async () => {
    const m = await loadModerationMetrics(db, 14, NOW)
    expect(m.range.days).toBe(14)
    expect(m.depths.openReports).toBe(4)
    expect(m.ages.oldest?.kind).toBe('dmca')
    expect(m.flow).toHaveLength(14)
    expect(m.moderators.length).toBe(2)
    expect(m.stale.length).toBeGreaterThan(0)
    expect(m.takedowns.handled).toBe(1)
  })
})
