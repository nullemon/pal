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
