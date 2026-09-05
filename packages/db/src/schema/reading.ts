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

/**
 * Following a series (docs/17 §D). A **bookmark is a shelf** — "reading", "completed",
 * "dropped" — and a **follow is a subscription**: "tell me when this updates". Conflating
 * them meant a reader who finished a series and moved it to `completed` either kept being
 * notified or had to throw the series out of their library to make it stop.
 *
 * This table is an **override layer over bookmarks, not a replacement for them**. The
 * fan-out treats a bookmark with no row here as an implicit follow on `all` — exactly the
 * behaviour every existing bookmarker has today — so shipping this unsubscribes nobody and
 * needs no backfill. A row appears the moment a reader says something the bookmark does not:
 * follow without bookmarking, mute a series they still shelve, or pick a quieter channel.
 *
 * `mode` names how loud the series is allowed to be; the reader's global
 * `notification_prefs` matrix still has the last word on every channel:
 *
 * | mode     | in-app | push | Discord | email digest |
 * |----------|--------|------|---------|--------------|
 * | `all`    | ✓      | ✓    | ✓       | ✓            |
 * | `push`   | ✓      | ✓    | ✗       | ✗            |
 * | `in_app` | ✓      | ✗    | ✗       | ✗            |
 * | `digest` | ✗      | ✗    | ✗       | ✓            |
 * | `off`    | ✗      | ✗    | ✗       | ✗            |
 *
 * `off` is a row rather than a missing one on purpose: it is how "I keep this on my shelf
 * but do not want to hear about it" is written down, and a missing row would silently mean
 * the opposite for anyone who bookmarked.
 */
export const seriesFollows = pgTable(
  'series_follows',
  {
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull().default('all'), // all|push|in_app|digest|off
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.seriesId] }),
    check(
      'series_follows_mode_check',
      sql`${t.mode} IN ('all', 'push', 'in_app', 'digest', 'off')`,
    ),
    // The fan-out's read: "who follows this series", muted rows excluded from the index.
    index('series_follows_series_idx').on(t.seriesId).where(sql`${t.mode} <> 'off'`),
    // `/me/notifications` — everything I follow, newest first. Muted rows belong here too,
    // which is why this one is not partial.
    index('series_follows_user_idx').on(t.userId, t.createdAt.desc()),
  ],
)
