import { sql } from 'drizzle-orm'
import { type Db, executeRows } from '../client.js'

/**
 * Moderation throughput and queue health (docs/04 "Community", docs/14 §3, docs/07
 * "Content compliance": takedown handling is "a feature with a UI, an SLA, and an audit
 * trail — not an inbox someone checks").
 *
 * `/admin/reports`, `/admin/comments` and `/admin/takedowns` each answer "what is in my
 * queue". None of them answers "is the queue being worked" — and the number that actually
 * decides whether a moderation team is failing is the age of the oldest untouched item, not
 * the size of the pile. Everything here is derived from rows the panel already writes:
 * `reports.handled_at`, `takedowns.actioned_at`, `comments.status` and the `audit_log` entry
 * every mutating admin action leaves behind. Nothing is sampled and nothing is estimated.
 */

export const MODERATION_WINDOWS = [7, 14, 30, 90] as const
export type ModerationWindow = (typeof MODERATION_WINDOWS)[number]
export const DEFAULT_MODERATION_WINDOW: ModerationWindow = 14

export const parseModerationWindow = (raw: string | undefined): ModerationWindow => {
  const n = Number(raw)
  return (MODERATION_WINDOWS as readonly number[]).includes(n)
    ? (n as ModerationWindow)
    : DEFAULT_MODERATION_WINDOW
}

const DAY_MS = 86_400_000

/**
 * A timestamp as a parameter. Drizzle sends `db.execute()` through postgres-js's `unsafe()`,
 * which takes no type hints and refuses a `Date` outright (`ERR_INVALID_ARG_TYPE`) — the
 * query builder's own `Date` handling does not apply here. PGlite accepts both, so this is
 * exactly the class of bug that only shows up against the real driver: every timestamp
 * parameter below goes through this and lands as ISO text with an explicit `::timestamptz`.
 */
const ts = (at: Date): string => at.toISOString()

/** A report untouched for longer than this is late; docs/07 gives DMCA notices 48 hours. */
export const REPORT_SLA_HOURS = 24
export const REPORT_STALE_HOURS = 24 * 7
export const TAKEDOWN_SLA_HOURS = 48

export interface MetricsRange {
  from: Date
  to: Date
  days: ModerationWindow
  /** `YYYY-MM-DD`, UTC, oldest first — one entry per day in the window. */
  buckets: string[]
}

export const metricsRange = (days: ModerationWindow, now = new Date()): MetricsRange => {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const from = new Date(to.getTime() - (days - 1) * DAY_MS)
  const buckets: string[] = []
  for (let i = 0; i < days; i++)
    buckets.push(new Date(from.getTime() + i * DAY_MS).toISOString().slice(0, 10))
  return { from, to, days, buckets }
}

// ---------------------------------------------------------------------------------------
// Queue depths

export interface QueueDepths {
  openReports: number
  triagedReports: number
  commentsHeld: number
  commentsShadow: number
  reportedComments: number
  imagesPending: number
  takedownsUnacknowledged: number
  takedownsOpen: number
}

export const queueDepths = async (db: Db): Promise<QueueDepths> => {
  const [row] = await executeRows<Record<string, number | string>>(
    db,
    sql`select
      (select count(*) from reports where status = 'open')::int as open_reports,
      (select count(*) from reports where status = 'triaged')::int as triaged_reports,
      (select count(*) from comments where status = 'pending' and deleted_at is null)::int as comments_held,
      (select count(*) from comments where status = 'shadow' and deleted_at is null)::int as comments_shadow,
      (select count(*) from reports where target_type = 'comment' and status = 'open')::int as reported_comments,
      (select count(*) from community_images where status = 'pending')::int as images_pending,
      (select count(*) from takedowns where actioned_at is null and action is null)::int as td_unack,
      (select count(*) from takedowns where actioned_at is null)::int as td_open`,
  )
  const n = (k: string) => Number(row?.[k] ?? 0)
  return {
    openReports: n('open_reports'),
    triagedReports: n('triaged_reports'),
    commentsHeld: n('comments_held'),
    commentsShadow: n('comments_shadow'),
    reportedComments: n('reported_comments'),
    imagesPending: n('images_pending'),
    takedownsUnacknowledged: n('td_unack'),
    takedownsOpen: n('td_open'),
  }
}

// ---------------------------------------------------------------------------------------
// Age of the open queue

export type AgeBandKey = 'fresh' | 'aging' | 'stale'

export interface AgeBand {
  key: AgeBandKey
  /** Inclusive lower bound in hours; the last band has no upper bound. */
  fromHours: number
  toHours: number | null
  count: number
}

export interface OldestOpen {
  id: number
  kind: string
  reason: string
  createdAt: Date
  ageMs: number
}

export interface ReportAgeProfile {
  total: number
  bands: AgeBand[]
  oldest: OldestOpen | null
  /** Open reports per kind, oldest first — the lane view docs/04 asks the queue to keep. */
  byKind: Array<{ kind: string; open: number; oldestAgeMs: number }>
}

/**
 * Three bands, not five. The reader has to act on this in one glance, and the only decisions
 * it supports are "today's work", "slipping" and "explain yourself" — extra buckets would
 * split the same total into slices too thin to read at a glance and would not change what
 * anyone does about it.
 */
export const reportAgeProfile = async (db: Db, now = new Date()): Promise<ReportAgeProfile> => {
  const [bands] = await executeRows<Record<string, number | string>>(
    db,
    sql`select
      count(*)::int as total,
      count(*) filter (where created_at > ${ts(now)}::timestamptz - interval '24 hours')::int as fresh,
      count(*) filter (where created_at <= ${ts(now)}::timestamptz - interval '24 hours' and created_at > ${ts(now)}::timestamptz - interval '7 days')::int as aging,
      count(*) filter (where created_at <= ${ts(now)}::timestamptz - interval '7 days')::int as stale
      from reports where status = 'open'`,
  )
  const [oldest] = await executeRows<{
    id: number
    kind: string
    reason: string
    created_at: Date | string
  }>(
    db,
    sql`select id, kind, reason, created_at from reports where status = 'open'
        order by created_at asc limit 1`,
  )
  const byKind = await executeRows<{ kind: string; open: number; oldest_at: Date | string }>(
    db,
    sql`select kind, count(*)::int as open, min(created_at) as oldest_at
        from reports where status = 'open' group by kind order by min(created_at) asc`,
  )
  const n = (k: string) => Number(bands?.[k] ?? 0)
  const at = (v: Date | string) => (v instanceof Date ? v : new Date(v))
  return {
    total: n('total'),
    bands: [
      { key: 'fresh', fromHours: 0, toHours: 24, count: n('fresh') },
      { key: 'aging', fromHours: 24, toHours: 24 * 7, count: n('aging') },
      { key: 'stale', fromHours: 24 * 7, toHours: null, count: n('stale') },
    ],
    oldest: oldest
      ? {
          id: Number(oldest.id),
          kind: oldest.kind,
          reason: oldest.reason,
          createdAt: at(oldest.created_at),
          ageMs: now.getTime() - at(oldest.created_at).getTime(),
        }
      : null,
    byKind: byKind.map((k) => ({
      kind: k.kind,
      open: Number(k.open),
      oldestAgeMs: now.getTime() - at(k.oldest_at).getTime(),
    })),
  }
}

// ---------------------------------------------------------------------------------------
// Time to action

export interface TimeToAction {
  /** Items that reached a decision inside the window. */
  handled: number
  medianMs: number | null
  p90Ms: number | null
  /** Slowest single decision in the window — the one that explains an ugly p90. */
  worstMs: number | null
}

const percentiles = async (
  db: Db,
  table: 'reports' | 'takedowns',
  from: Date,
): Promise<TimeToAction> => {
  const elapsed =
    table === 'reports'
      ? sql`extract(epoch from (handled_at - created_at))`
      : sql`extract(epoch from (actioned_at - received_at))`
  const where =
    table === 'reports'
      ? sql`handled_at is not null and handled_at >= ${ts(from)}::timestamptz`
      : sql`actioned_at is not null and actioned_at >= ${ts(from)}::timestamptz`
  const [row] = await executeRows<{
    n: number
    p50: number | string | null
    p90: number | string | null
    worst: number | string | null
  }>(
    db,
    sql`select count(*)::int as n,
                percentile_cont(0.5) within group (order by ${elapsed}) as p50,
                percentile_cont(0.9) within group (order by ${elapsed}) as p90,
                max(${elapsed}) as worst
         from ${sql.raw(table)} where ${where}`,
  )
  const ms = (v: number | string | null) =>
    v === null || v === undefined ? null : Number(v) * 1000
  return {
    handled: Number(row?.n ?? 0),
    medianMs: ms(row?.p50 ?? null),
    p90Ms: ms(row?.p90 ?? null),
    worstMs: ms(row?.worst ?? null),
  }
}

export const reportTimeToAction = (db: Db, from: Date) => percentiles(db, 'reports', from)
export const takedownTimeToAction = (db: Db, from: Date) => percentiles(db, 'takedowns', from)

// ---------------------------------------------------------------------------------------
// Who is actually working

/**
 * The `audit_log` action prefixes that are moderation work, grouped into the four lanes the
 * panel has screens for. Anything outside this list — settings, appearance, billing, imports
 * — is admin work, not moderation, and stays out of the count so the numbers mean one thing.
 */
export const MODERATION_ACTION_LANES = {
  reports: ['report.'],
  comments: ['comment.', 'community_image.'],
  users: ['user.'],
  takedowns: ['takedown.'],
} as const
export type ModerationLane = keyof typeof MODERATION_ACTION_LANES

export interface ModeratorRow {
  actorId: number | null
  username: string | null
  role: string | null
  total: number
  reports: number
  comments: number
  users: number
  takedowns: number
  lastActionAt: Date
  /** One count per day of the window, oldest first. */
  perDay: number[]
}

const LANE_CASE = sql.raw(`case
  when action like 'report.%' then 'reports'
  when action like 'comment.%' or action like 'community_image.%' then 'comments'
  when action like 'user.%' then 'users'
  when action like 'takedown.%' then 'takedowns'
  else null end`)

const MODERATION_FILTER = sql.raw(`(
  action like 'report.%' or action like 'comment.%' or action like 'community_image.%'
  or action like 'user.%' or action like 'takedown.%')`)

export const moderatorActivity = async (db: Db, range: MetricsRange): Promise<ModeratorRow[]> => {
  const rows = await executeRows<{
    actor_id: number | null
    username: string | null
    role: string | null
    lane: ModerationLane | null
    n: number
    last_at: Date | string
  }>(
    db,
    sql`select a.actor_id, u.username, u.role::text as role, ${LANE_CASE} as lane,
                count(*)::int as n, max(a.created_at) as last_at
         from audit_log a
         left join users u on u.id = a.actor_id
         where a.created_at >= ${ts(range.from)}::timestamptz and ${MODERATION_FILTER}
         group by a.actor_id, u.username, u.role, ${LANE_CASE}`,
  )
  const perDay = await executeRows<{ actor_id: number | null; bucket: string; n: number }>(
    db,
    sql`select a.actor_id, to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD') as bucket, count(*)::int as n
         from audit_log a
         where a.created_at >= ${ts(range.from)}::timestamptz and ${MODERATION_FILTER}
         group by a.actor_id, 2`,
  )
  const byActor = new Map<string, ModeratorRow>()
  const at = (v: Date | string) => (v instanceof Date ? v : new Date(v))
  for (const r of rows) {
    const key = String(r.actor_id ?? 'system')
    const row = byActor.get(key) ?? {
      actorId: r.actor_id === null ? null : Number(r.actor_id),
      username: r.username,
      role: r.role,
      total: 0,
      reports: 0,
      comments: 0,
      users: 0,
      takedowns: 0,
      lastActionAt: at(r.last_at),
      perDay: range.buckets.map(() => 0),
    }
    const n = Number(r.n)
    row.total += n
    if (r.lane) row[r.lane] += n
    if (at(r.last_at) > row.lastActionAt) row.lastActionAt = at(r.last_at)
    byActor.set(key, row)
  }
  const index = new Map(range.buckets.map((b, i) => [b, i]))
  for (const p of perDay) {
    const row = byActor.get(String(p.actor_id ?? 'system'))
    const i = index.get(p.bucket)
    if (row && i !== undefined) row.perDay[i] = Number(p.n)
  }
  return [...byActor.values()].sort((a, b) => b.total - a.total)
}

// ---------------------------------------------------------------------------------------
// Is the queue growing?

export interface QueueFlowPoint {
  bucket: string
  opened: number
  resolved: number
}

/**
 * Reports opened against reports resolved, per day. The one chart that answers whether the
 * team is keeping up: a queue whose bars are level is being worked, one whose opened bars
 * out-run resolved is growing however impressive the raw action count looks.
 */
export const reportQueueFlow = async (db: Db, range: MetricsRange): Promise<QueueFlowPoint[]> => {
  const rows = await executeRows<{ bucket: string; opened: number; resolved: number }>(
    db,
    sql`select to_char(d, 'YYYY-MM-DD') as bucket,
                (select count(*) from reports r where r.created_at >= d and r.created_at < d + interval '1 day')::int as opened,
                (select count(*) from reports r where r.handled_at >= d and r.handled_at < d + interval '1 day')::int as resolved
         from generate_series(${ts(range.from)}::timestamptz, ${ts(range.to)}::timestamptz, interval '1 day') d`,
  )
  const byBucket = new Map(rows.map((r) => [r.bucket, r]))
  return range.buckets.map((bucket) => ({
    bucket,
    opened: Number(byBucket.get(bucket)?.opened ?? 0),
    resolved: Number(byBucket.get(bucket)?.resolved ?? 0),
  }))
}

// ---------------------------------------------------------------------------------------
// What is going stale

export type StaleQueue = 'report' | 'comment' | 'takedown'

export interface StaleItem {
  queue: StaleQueue
  id: number
  title: string
  detail: string
  href: string
  since: Date
  ageMs: number
  /** Past the queue's own SLA — the rows the screen is loud about. */
  overdue: boolean
}

/**
 * The oldest untouched item in each of the three queues, merged into one list, oldest first.
 * A screen that only shows totals lets a single six-week-old DMCA notice hide behind a
 * healthy average, so the items themselves are named and linked.
 */
export const staleQueueItems = async (
  db: Db,
  now = new Date(),
  limit = 8,
): Promise<StaleItem[]> => {
  const at = (v: Date | string) => (v instanceof Date ? v : new Date(v))
  const [reports, comments, takedowns] = await Promise.all([
    executeRows<{ id: number; kind: string; reason: string; created_at: Date | string }>(
      db,
      sql`select id, kind, reason, created_at from reports where status = 'open'
          order by created_at asc limit ${limit}`,
    ),
    executeRows<{ id: number; created_at: Date | string; username: string | null }>(
      db,
      sql`select c.id, c.created_at, u.username from comments c
          left join users u on u.id = c.user_id
          where c.status = 'pending' and c.deleted_at is null
          order by c.created_at asc limit ${limit}`,
    ),
    executeRows<{
      id: number
      claimant: string
      received_at: Date | string
      action: string | null
    }>(
      db,
      sql`select id, claimant, received_at, action from takedowns where actioned_at is null
          order by received_at asc limit ${limit}`,
    ),
  ])
  const items: StaleItem[] = [
    ...reports.map((r) => {
      const since = at(r.created_at)
      const ageMs = now.getTime() - since.getTime()
      return {
        queue: 'report' as const,
        id: Number(r.id),
        title: `Report #${Number(r.id)} · ${r.kind}`,
        detail: r.reason,
        href: `/admin/reports?status=open&kind=${encodeURIComponent(r.kind)}`,
        since,
        ageMs,
        overdue: ageMs > REPORT_SLA_HOURS * 3_600_000,
      }
    }),
    ...comments.map((c) => {
      const since = at(c.created_at)
      const ageMs = now.getTime() - since.getTime()
      return {
        queue: 'comment' as const,
        id: Number(c.id),
        title: `Comment #${Number(c.id)}`,
        detail: c.username ? `held for review · @${c.username}` : 'held for review',
        href: '/admin/comments?tab=pending',
        since,
        ageMs,
        overdue: ageMs > REPORT_SLA_HOURS * 3_600_000,
      }
    }),
    ...takedowns.map((t) => {
      const since = at(t.received_at)
      const ageMs = now.getTime() - since.getTime()
      return {
        queue: 'takedown' as const,
        id: Number(t.id),
        title: `Takedown #${Number(t.id)} · ${t.claimant}`,
        detail: t.action === null ? 'not acknowledged' : `${t.action}, not closed`,
        href: '/admin/takedowns?status=open',
        since,
        ageMs,
        overdue: ageMs > TAKEDOWN_SLA_HOURS * 3_600_000,
      }
    }),
  ]
  return items.sort((a, b) => b.ageMs - a.ageMs).slice(0, limit)
}

// ---------------------------------------------------------------------------------------

export interface ModerationMetrics {
  range: MetricsRange
  depths: QueueDepths
  ages: ReportAgeProfile
  reports: TimeToAction
  takedowns: TimeToAction
  flow: QueueFlowPoint[]
  moderators: ModeratorRow[]
  stale: StaleItem[]
}

/** Everything `/admin/moderation` renders, in one round of parallel queries. */
export const loadModerationMetrics = async (
  db: Db,
  days: ModerationWindow = DEFAULT_MODERATION_WINDOW,
  now: Date = new Date(),
): Promise<ModerationMetrics> => {
  const range = metricsRange(days, now)
  const [depths, ages, reports, takedowns, flow, moderators, stale] = await Promise.all([
    queueDepths(db),
    reportAgeProfile(db, now),
    reportTimeToAction(db, range.from),
    takedownTimeToAction(db, range.from),
    reportQueueFlow(db, range),
    moderatorActivity(db, range),
    staleQueueItems(db, now),
  ])
  return { range, depths, ages, reports, takedowns, flow, moderators, stale }
}
