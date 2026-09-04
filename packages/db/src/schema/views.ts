import { bigint, date, index, integer, pgTable, primaryKey } from 'drizzle-orm/pg-core'
import { ref } from './_shared.js'
import { series } from './catalog.js'
import { chapters } from './chapters.js'
import { bytea } from './custom-types.js'

/**
 * Append-only view events, one row per viewer × chapter × day (docs/02 "Views and ranking").
 * The table is partitioned by day in Postgres (migration 0003); Drizzle cannot declare
 * `PARTITION BY`, so the model below is the same table without it. Partitions are created a
 * day ahead and dropped after 90 days by the worker's `stats.rollup` pass through
 * `view_events_ensure_partitions` / `view_events_drop_partitions_before` (migration 9015).
 *
 * The primary key *is* the dedupe rule: one viewer key, one chapter, one UTC day. Inserting
 * the same view twice is a no-op, so a reader who refreshes ten times counts once no matter
 * how many app instances handled the requests.
 */
export const viewEvents = pgTable(
  'view_events',
  {
    seriesId: ref('series_id').notNull(),
    chapterId: bigint('chapter_id', { mode: 'number' }).notNull().default(0), // 0 = series page
    bucket: date('bucket', { mode: 'string' }).notNull(),
    viewerKey: bytea('viewer_key').notNull(), // hash(user_id | ip+ua salt) for dedupe
  },
  (t) => [primaryKey({ columns: [t.bucket, t.seriesId, t.viewerKey, t.chapterId] })],
)

/**
 * Daily views per series — what Popular Weekly / Monthly aggregate over, and the record of
 * what has already been added to `series.view_count`.
 */
export const seriesStatsDaily = pgTable(
  'series_stats_daily',
  {
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    bucket: date('bucket', { mode: 'string' }).notNull(),
    views: integer('views').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.bucket] }),
    index('series_stats_daily_bucket_idx').on(t.bucket),
  ],
)

/**
 * The per-chapter twin (migration 9015). `chapters.view_count` is denormalised exactly like
 * `series.view_count`, and the rollup adds the difference between the recomputed daily total
 * and the one stored here — so a re-run adds nothing and the numbers the seeder and the
 * importer wrote are never overwritten.
 */
export const chapterStatsDaily = pgTable(
  'chapter_stats_daily',
  {
    chapterId: ref('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    bucket: date('bucket', { mode: 'string' }).notNull(),
    views: integer('views').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.chapterId, t.bucket] }),
    index('chapter_stats_daily_bucket_idx').on(t.bucket),
  ],
)
