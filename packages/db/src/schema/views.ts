import { bigint, date, integer, pgTable, primaryKey } from 'drizzle-orm/pg-core'
import { ref } from './_shared.js'
import { series } from './catalog.js'
import { bytea } from './custom-types.js'

/**
 * Append-only view events. docs/02 partitions this by day; Drizzle cannot declare
 * partitions, so it is a plain table with the same key for now — the rollup job and the
 * 90-day drop work on `bucket` either way.
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

export const seriesStatsDaily = pgTable(
  'series_stats_daily',
  {
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    bucket: date('bucket', { mode: 'string' }).notNull(),
    views: integer('views').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.bucket] })],
)
