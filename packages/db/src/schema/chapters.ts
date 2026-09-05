import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
} from 'drizzle-orm/pg-core'
import { createdAt, deletedAt, identity, ref, timestamptz, updatedAt } from './_shared.js'
import { groups, series } from './catalog.js'
import { chapterState } from './enums.js'
import { users } from './identity.js'

/** One uploaded original, in display order (docs/03 upload flow step 6). */
export interface ChapterSource {
  idx: number
  key: string
  bytes: number
  sha256: string
}

/** One emitted page (a source, or one segment of a split long strip) with its variants. */
export interface ProcessedPage {
  key: string
  width: number
  height: number
  bytes: number
  blurHash: string | null
  variants: PageVariant[]
}

/** `chapters.processing` — written by the upload commit and the worker (docs/03). */
export interface ChapterProcessing {
  sources: ChapterSource[]
  /** Per-source results kept while a run has failures so "retry failed only" can rebuild the rows. */
  results?: Record<string, ProcessedPage[]>
  progress: { done: number; total: number }
  /** Per-page error messages keyed by source idx; empty when the last run succeeded. */
  errors: Record<string, string>
  attempt: number
  /** `failed` = re-run only the sources listed in `errors` (docs/03 "retry failed pages only"). */
  mode?: 'all' | 'failed'
  /** Set by the upload commit: premium flag and target publish time applied when processing ends. */
  after?: { isPremium?: boolean; publishedAt?: string | null }
  /**
   * The watermark burned into the pages this document produced, as
   * `watermarkFingerprint()` — `''` when the run applied no mark (docs/03 "Re-applying the
   * mark").
   *
   * Written only by a run that finished successfully, so it describes the objects
   * `chapter_pages` actually points at. It is the cheap index behind the panel's "which
   * chapters carry the current mark" column; **absent** means the chapter was processed
   * before this was recorded, which is not the same as "unmarked" and is never treated as
   * such — only re-deriving the address from the original can settle that, which is what
   * `watermark.reapply` does.
   */
  watermark?: string
  startedAt: string | null
  finishedAt: string | null
}

export const chapters = pgTable(
  'chapters',
  {
    id: identity(),
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    number: numeric('number', { precision: 10, scale: 3, mode: 'number' }).notNull(), // 12.5 and 7.1 work
    volume: smallint('volume'),
    title: text('title'),
    state: chapterState('state').notNull().default('draft'),
    isPremium: boolean('is_premium').notNull().default(false),
    earlyAccessUntil: timestamptz('early_access_until'), // premium-only window before it goes free
    publishedAt: timestamptz('published_at'),
    pageCount: smallint('page_count').notNull().default(0),
    viewCount: bigint('view_count', { mode: 'number' }).notNull().default(0),
    uploadedBy: ref('uploaded_by').references(() => users.id),
    // P5 (migration 9005): the worker's processing document — sources, progress, per-page errors
    processing: jsonb('processing').$type<ChapterProcessing | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique('chapters_series_id_number_unique').on(t.seriesId, t.number),
    index('chapters_series_number_idx')
      .on(t.seriesId, t.number.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    index('chapters_scheduled_idx').on(t.state, t.publishedAt).where(sql`${t.state} = 'scheduled'`), // the publisher's work queue
    index('chapters_published_at_idx')
      .on(t.publishedAt.desc())
      .where(sql`${t.state} = 'published' AND ${t.deletedAt} IS NULL`), // "latest updates"
    // migration 9030: which chapters carry the current watermark. Appearance → Watermark
    // asks this five times per load, Chapters → Mark filters on it, and `watermark.reapply`
    // walks it in id order between batches — all of them over the same partial set.
    index('chapters_watermark_idx')
      .on(sql`(${t.processing} ->> 'watermark')`, t.id)
      .where(sql`${t.deletedAt} IS NULL AND ${t.pageCount} > 0`),
  ],
)

export interface PageVariant {
  w: number
  fmt: 'avif' | 'webp' | 'jpg' | 'svg'
  bytes: number
  key?: string
}

export const chapterPages = pgTable(
  'chapter_pages',
  {
    chapterId: ref('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    idx: smallint('idx').notNull(), // 0-based display order
    key: text('key').notNull(), // content-addressed base object key
    width: integer('width').notNull(), // intrinsic dimensions: zero layout shift
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    blurHash: text('blur_hash'),
    variants: jsonb('variants').$type<PageVariant[]>().notNull().default([]),
  },
  (t) => [primaryKey({ columns: [t.chapterId, t.idx] })],
)

export const chapterGroups = pgTable(
  'chapter_groups',
  {
    chapterId: ref('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    groupId: ref('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.chapterId, t.groupId] }),
    index('chapter_groups_group_id_idx').on(t.groupId),
  ],
)
