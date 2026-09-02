import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
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
import { citext, tsvector } from './custom-types.js'
import { pubState, readingDirection, seriesStatus, seriesType } from './enums.js'

/** Structured release schedule (docs/13): weekday 0–6 (Sunday = 0), local time, IANA zone. */
export interface ReleaseSchedule {
  weekday: number
  time?: string
  tz?: string
  /** Human note, e.g. "Every Friday". */
  note?: string
}

/** One queued cover / banner original: the worker writes the variants, then points the key column at them. */
export interface SeriesArtPendingEntry {
  key: string
  requestedAt: string
  requestedBy: number
  error?: string
}
export type SeriesArtPending = Partial<Record<'cover' | 'banner', SeriesArtPendingEntry>>

/** Rich text stored as structured JSON (docs/12 §3); rendered by the SEO/text renderer. */
export type RichText = { type: 'doc'; children: readonly unknown[] }

export const series = pgTable(
  'series',
  {
    id: identity(),
    slug: citext('slug').notNull().unique(),
    title: text('title').notNull(),
    type: seriesType('type').notNull(),
    status: seriesStatus('status').notNull().default('ongoing'),
    state: pubState('state').notNull().default('draft'),
    synopsis: text('synopsis'),
    coverKey: text('cover_key'),
    bannerKey: text('banner_key'),
    /** Uploaded cover / banner originals the worker has not re-encoded yet (`series.art`). */
    artPending: jsonb('art_pending').$type<SeriesArtPending | null>(),
    coverColor: text('cover_color'), // dominant colour extracted at ingest (docs/05)
    country: char('country', { length: 2 }),
    releasedYear: smallint('released_year'),
    serialization: text('serialization'),
    ageRating: text('age_rating'), // 'all' | 'teen' | 'mature'
    isFeatured: boolean('is_featured').notNull().default(false), // drives the hero carousel
    isPinned: boolean('is_pinned').notNull().default(false),
    commentsEnabled: boolean('comments_enabled').notNull().default(true),
    linkedSeriesId: bigint('linked_series_id', { mode: 'number' }).references(
      (): AnyPgColumn => series.id,
    ),
    readingDirection: readingDirection('reading_direction').notNull().default('vertical'),
    releaseSchedule: jsonb('release_schedule').$type<ReleaseSchedule | null>(),
    contentWarnings: text('content_warnings').array().notNull().default(sql`'{}'::text[]`),
    publishedAt: timestamptz('published_at'),
    // denormalised counters, maintained by triggers (migration 0002); never computed on read
    chapterCount: integer('chapter_count').notNull().default(0),
    bookmarkCount: integer('bookmark_count').notNull().default(0),
    viewCount: bigint('view_count', { mode: 'number' }).notNull().default(0),
    ratingSum: bigint('rating_sum', { mode: 'number' }).notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 1, mode: 'number' }).generatedAlwaysAs(
      sql`CASE WHEN rating_count > 0 THEN round(rating_sum::numeric / rating_count, 1) ELSE 0 END`,
    ),
    lastChapterAt: timestamptz('last_chapter_at'),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(title, '')), 'A')`,
    ),
    // SEO (docs/12 §9)
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    seoText: jsonb('seo_text').$type<RichText | null>(), // the "About {title}" block
    focusKeyword: text('focus_keyword'),
    noindex: boolean('noindex').notNull().default(false),
    canonicalUrl: text('canonical_url'),
    ogImageKey: text('og_image_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('series_search_vector_idx').using('gin', t.searchVector),
    index('series_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    index('series_state_last_chapter_idx')
      .on(t.state, t.lastChapterAt.desc().nullsLast())
      .where(sql`${t.deletedAt} IS NULL`),
    index('series_type_status_idx')
      .on(t.type, t.status)
      .where(sql`${t.deletedAt} IS NULL AND ${t.state} = 'published'`),
    index('series_pinned_idx')
      .on(t.isPinned, t.lastChapterAt.desc().nullsLast())
      .where(sql`${t.deletedAt} IS NULL AND ${t.state} = 'published'`),
  ],
)

/** The 20+ localized aliases per series. */
export const seriesTitles = pgTable(
  'series_titles',
  {
    id: identity(),
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    lang: text('lang'),
  },
  (t) => [
    unique('series_titles_series_id_title_unique').on(t.seriesId, t.title),
    index('series_titles_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
  ],
)

export interface FaqEntry {
  q: string
  a: string
}

export const genres = pgTable('genres', {
  id: identity(),
  slug: citext('slug').notNull().unique(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('genre'), // 'genre' | 'theme' | 'format'
  // SEO (docs/12 §9)
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  intro: jsonb('intro').$type<RichText | null>(), // rich text above the grid
  faq: jsonb('faq').$type<FaqEntry[] | null>(), // → FAQPage
})

export const seriesGenres = pgTable(
  'series_genres',
  {
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    genreId: ref('genre_id')
      .notNull()
      .references(() => genres.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.genreId] }),
    index('series_genres_genre_id_idx').on(t.genreId, t.seriesId),
  ],
)

/** Authors, artists, studios. */
export const people = pgTable('people', {
  id: identity(),
  slug: citext('slug').notNull().unique(),
  name: text('name').notNull(),
})

export const seriesPeople = pgTable(
  'series_people',
  {
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    personId: ref('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    credit: text('credit').notNull(), // 'author' | 'artist' | 'translator'
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.personId, t.credit] })],
)

/** Scanlation groups and credits (docs/13). */
export const groups = pgTable('groups', {
  id: identity(),
  slug: citext('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  logoKey: text('logo_key'),
  links: jsonb('links').$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
})
