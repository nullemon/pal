import {
  rollupWindow,
  shiftBucket,
  VIEW_PARTITION_AHEAD_DAYS,
  VIEW_RETENTION_DAYS,
} from '@palscans/core'
import {
  type Db,
  dropViewPartitions,
  ensureViewPartitions,
  type RollupResult,
  rollupStats,
} from '@palscans/db'
import { log } from '../lib/log.js'

/**
 * `stats.rollup` (docs/02 "Views and ranking"): the job that turns raw `view_events` into
 * the numbers the site shows. It had neither a producer nor a handler; this is both halves.
 *
 * Every pass does three things, in this order:
 *   1. make sure `view_events` has a partition for today and the next couple of days, so a
 *      view always lands in a dated partition instead of `view_events_default`;
 *   2. recompute the daily totals for a short trailing window and add the difference to
 *      `series.view_count` / `chapters.view_count`;
 *   3. once a day, drop partitions older than 90 days.
 *
 * Step 2 is idempotent, so a pass that overlaps another, or re-runs after a crash, changes
 * nothing the first one already applied.
 */

export interface StatsRollupOptions {
  /** Widen the recomputed window (a backfill). Defaults to yesterday → today. */
  from?: string
  to?: string
  /** Days before today to recompute when `from` is not given. */
  lookbackDays?: number
  keepDays?: number
  partitionAheadDays?: number
  now?: Date
}

export interface StatsRollupSummary {
  created: string[]
  dropped: string[]
  rollup: RollupResult
}

/** How often the retention sweep runs; the rollup itself runs far more often. */
const RETENTION_EVERY_MS = 6 * 60 * 60 * 1000
let lastRetention = 0

export const runStatsRollup = async (
  db: Db,
  opts: StatsRollupOptions = {},
): Promise<StatsRollupSummary> => {
  const now = opts.now ?? new Date()
  const today = now.toISOString().slice(0, 10)
  const window =
    opts.from || opts.to
      ? {
          from: opts.from ?? shiftBucket(opts.to ?? today, -1),
          to: opts.to ?? today,
        }
      : rollupWindow(now, opts.lookbackDays ?? 1)

  // Today and tomorrow first: a partition that does not exist yet is the only way a view
  // can end up in view_events_default, and the default partition cannot be dropped by age.
  const created = await ensureViewPartitions(db, {
    from: today,
    days: opts.partitionAheadDays ?? VIEW_PARTITION_AHEAD_DAYS,
  })

  const rollup = await rollupStats(db, window)

  let dropped: string[] = []
  const due = now.getTime() - lastRetention >= RETENTION_EVERY_MS
  if (due) {
    lastRetention = now.getTime()
    dropped = await dropViewPartitions(db, {
      today,
      keepDays: opts.keepDays ?? VIEW_RETENTION_DAYS,
    })
    if (dropped.length) log.info('view_events partitions dropped', { dropped })
  }

  if (rollup.seriesBuckets > 0 || rollup.chapterBuckets > 0) {
    log.info('stats.rollup applied', {
      from: rollup.from,
      to: rollup.to,
      seriesBuckets: rollup.seriesBuckets,
      chapterBuckets: rollup.chapterBuckets,
      seriesDelta: rollup.seriesDelta,
      chapterDelta: rollup.chapterDelta,
    })
  }
  return { created, dropped, rollup }
}

/** Tests: forget when the retention sweep last ran. */
export const resetRetentionClock = (): void => {
  lastRetention = 0
}
