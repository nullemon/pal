import {
  shiftBucket,
  VIEW_PARTITION_AHEAD_DAYS,
  VIEW_RETENTION_DAYS,
  type ViewHit,
  viewerKeyHex,
} from '@palscans/core'
import { sql } from 'drizzle-orm'
import { type Db, executeRows } from '../client.js'

/**
 * The database half of the view pipeline (docs/02 "Views and ranking"). Three jobs:
 * writing a batch of view events, rolling them into the daily tables and the denormalised
 * counters, and keeping the daily partitions of `view_events` created and expired.
 *
 * The SQL functions live in migration 9015 rather than here so the rollup is one round trip
 * and one transaction — a rollup half-applied is a counter that is permanently wrong.
 */

/**
 * Insert a batch of view events. One statement per batch, no matter how many hits.
 *
 * Two things happen inside the statement instead of costing extra round trips:
 *   * the join against `series` / `chapters` throws away hits for anything that is not a
 *     published, live row — a forged POST cannot put junk in the table;
 *   * `ON CONFLICT DO NOTHING` against the primary key `(bucket, series_id, viewer_key,
 *     chapter_id)` is the authoritative dedupe: the same viewer and chapter on the same UTC
 *     day is one row, whichever app instance saw it.
 *
 * Returns the number of rows that were actually new.
 */
export const recordViewEvents = async (db: Db, hits: readonly ViewHit[]): Promise<number> => {
  if (hits.length === 0) return 0
  const values = sql.join(
    hits.map(
      (h) =>
        sql`(${h.seriesId}::bigint, ${h.chapterId}::bigint, ${h.bucket}::date, decode(${viewerKeyHex(h.viewerKey)}, 'hex'))`,
    ),
    sql`, `,
  )
  const rows = await executeRows<{ ok: number }>(
    db,
    sql`
      insert into view_events (series_id, chapter_id, bucket, viewer_key)
      select v.series_id, v.chapter_id, v.bucket, v.viewer_key
      from (values ${values}) as v(series_id, chapter_id, bucket, viewer_key)
      join series s on s.id = v.series_id and s.state = 'published' and s.deleted_at is null
      where v.chapter_id = 0
         or exists (
           select 1 from chapters c
           where c.id = v.chapter_id and c.series_id = v.series_id and c.deleted_at is null
         )
      on conflict do nothing
      returning 1 as ok
    `,
  )
  return rows.length
}

export interface RollupResult {
  from: string
  to: string
  /** (series, day) totals that changed. */
  seriesBuckets: number
  /** (chapter, day) totals that changed. */
  chapterBuckets: number
  /** Views added to `series.view_count` by this pass (negative only if a day was corrected down). */
  seriesDelta: number
  chapterDelta: number
}

/**
 * Recompute `series_stats_daily` / `chapter_stats_daily` for a window of days and move the
 * difference into the denormalised counters. Idempotent: running it twice over the same
 * window adds nothing the second time.
 */
export const rollupStats = async (
  db: Db,
  window: { from: string; to: string },
): Promise<RollupResult> => {
  const rows = await executeRows<{ result: RollupResult }>(
    db,
    sql`select stats_rollup(${window.from}::date, ${window.to}::date) as result`,
  )
  const result = rows[0]?.result
  const parsed = typeof result === 'string' ? (JSON.parse(result) as RollupResult) : result
  return (
    parsed ?? {
      from: window.from,
      to: window.to,
      seriesBuckets: 0,
      chapterBuckets: 0,
      seriesDelta: 0,
      chapterDelta: 0,
    }
  )
}

/**
 * Make sure `from` and the next `days` days have a partition, so a view always lands in a
 * dated one instead of `view_events_default`. Rows that already reached the default
 * partition for those days are moved across.
 */
export const ensureViewPartitions = async (
  db: Db,
  opts: { from: string; days?: number } = { from: new Date().toISOString().slice(0, 10) },
): Promise<string[]> => {
  const rows = await executeRows<{ names: string[] }>(
    db,
    sql`select view_events_ensure_partitions(${opts.from}::date, ${opts.days ?? VIEW_PARTITION_AHEAD_DAYS}) as names`,
  )
  return rows[0]?.names ?? []
}

/**
 * Retention (docs/02): drop whole partitions older than `keepDays`, and sweep any rows of
 * that age out of the default partition. Returns the partitions dropped.
 */
export const dropViewPartitions = async (
  db: Db,
  opts: { today?: string; keepDays?: number } = {},
): Promise<string[]> => {
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const cutoff = shiftBucket(today, -(opts.keepDays ?? VIEW_RETENTION_DAYS))
  const rows = await executeRows<{ names: string[] }>(
    db,
    sql`select view_events_drop_partitions_before(${cutoff}::date) as names`,
  )
  return rows[0]?.names ?? []
}

/** Every partition of `view_events`, oldest first, with `view_events_default` last. */
export const listViewPartitions = async (db: Db): Promise<string[]> => {
  const rows = await executeRows<{ name: string }>(
    db,
    sql`
      select c.relname as name
      from pg_class c
      join pg_inherits i on i.inhrelid = c.oid
      join pg_class p on p.oid = i.inhparent
      join pg_namespace n on n.oid = c.relnamespace
      where p.relname = 'view_events' and n.nspname = 'public'
      order by c.relname
    `,
  )
  return rows.map((r) => r.name)
}
