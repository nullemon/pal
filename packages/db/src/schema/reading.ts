import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
} from 'drizzle-orm/pg-core'
import { createdAt, ref, timestamptz, updatedAt } from './_shared.js'
import { series } from './catalog.js'
import { chapters } from './chapters.js'
import { users } from './identity.js'

export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('reading'), // reading|planned|completed|paused|dropped
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.seriesId] }),
    index('bookmarks_series_id_idx').on(t.seriesId),
  ],
)

export const readingProgress = pgTable(
  'reading_progress',
  {
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    chapterId: ref('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    pageIdx: smallint('page_idx').notNull().default(0),
    scrollPct: real('scroll_pct').notNull().default(0), // resume exactly where they stopped
    readAt: timestamptz('read_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.seriesId] }),
    index('reading_progress_user_read_at_idx').on(t.userId, t.readAt.desc()),
  ],
)

/** Full history; feeds "recently read". */
export const chapterReads = pgTable(
  'chapter_reads',
  {
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chapterId: ref('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    readAt: timestamptz('read_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.chapterId] })],
)

export const ratings = pgTable(
  'ratings',
  {
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    score: smallint('score').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.seriesId] }),
    check('ratings_score_check', sql`${t.score} BETWEEN 1 AND 10`),
  ],
)
