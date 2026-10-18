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
  /**
   * Pages an operator deleted, as `sourceIdx:segment` (@palscans/core/chapters).
   *
   * The only field here that records a human decision rather than a machine result, and the
   * reason it exists: every other field is rebuilt from the uploaded originals by a
   * reprocessing run, so a deletion expressed by editing `results` is silently undone the
   * next time `watermark.reapply` or a retry regenerates that source. `flattenPages` applies
   * this on every build of `chapter_pages`, so a deleted page stays deleted.
   */
  dropped?: string[]
  /**
   * A gallery import that still has to be downloaded (ImgChest, `@palscans/core/gallery`).
   *
   * Present between the operator pressing Import and the worker finishing the download, and
   * it is what distinguishes the two ways a chapter can have no sources yet: a fetch that has
   * not run, versus an upload that went wrong. `chapter.fetch` clears it once `sources` is
   * written, so a chapter carrying both is a chapter whose download died midway — which is
   * exactly the state Retry needs to recognise in order to resume the download rather than
   * re-run an encode over nothing.
   */
  fetch?: {
    url: string
    provider: string
    title?: string | null
    /**
     * Where the pages should end up.
     *
     * `remote` leaves them on the host and serves them through our proxy — no bucket usage,
     * no watermark, no encoded variants. `storage` is the original behaviour. A remote import
     * falls back to `storage` on its own when the host will not answer our server reliably,
     * and records which it used, so the panel can say what a chapter actually is.
     */
    mode?: 'remote' | 'storage'
    /**
     * Page URLs given outright, instead of a gallery to resolve.
     *
     * A manifest may list a chapter's images directly rather than pointing at an album, and
     * a pasted URL list does the same. Carrying them here means the worker has one shape to
     * handle either way, and `url` stays the human-readable origin for the panel.
     */
    links?: string[]
  }
  /** What the finished pages are. Absent means `storage`, which every pre-9046 chapter is. */
  pageSource?: 'remote' | 'storage'
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
    /**
     * BCP-47-ish language tag (migration 9044). `en` for everything uploaded before it, and
     * the default for everything after, so a single-language site never has to think about it.
     */
    language: text('language').notNull().default('en'),
    /**
     * This chapter's line on the credit page — a translator's aside, a word from the author.
     * Null falls back to the site's default note, which is what clearing the box means.
     */
    creditNote: text('credit_note'),
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
    // One chapter N *per language*: the old `(series_id, number)` constraint made a German
    // chapter 1 beside the English one impossible, which is the whole feature.
    unique('chapters_series_number_language_unique').on(t.seriesId, t.number, t.language),
    // The reader's shape: this series, this language, by number — the chapter list and both
    // neighbour lookups.
    index('chapters_series_language_number_idx')
      .on(t.seriesId, t.language, t.number.desc())
      .where(sql`${t.deletedAt} IS NULL`),
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
    /**
     * Set when the page is served from the host it was imported from (migration 9046).
     *
     * Its presence is the flag: when it is set, `key` names no object in our bucket and
     * `variants` is empty, because nothing was encoded. The reader turns it into our own
     * proxy URL rather than handing the origin to the browser, so entitlement still applies
     * and the host is never visible in the page source.
     */
    remoteUrl: text('remote_url'),
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

/**
 * A manifest link this series follows (docs/03 "Keeping a manifest in sync").
 *
 * The import panel takes a one-off snapshot of a manifest: paste the link, pick the chapters,
 * done. But a manifest is a living file — the group that maintains it adds chapter 48 the
 * evening it is released — and a site whose catalogue is a snapshot of the day somebody
 * happened to paste the link is a site that is permanently behind the source it imports from.
 *
 * So the link is kept, and the worker re-reads it on a timer and imports what is new. One row
 * per (series, url, language): the same file may be followed in two languages, and two
 * different files may both feed one series.
 */
export const manifestSources = pgTable(
  'manifest_sources',
  {
    id: identity(),
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    language: text('language').notNull().default('en'),
    /** Where new chapters' pages go, exactly as the import panel's own toggle decides it. */
    store: text('store').$type<'remote' | 'storage'>().notNull().default('remote'),
    /**
     * What a chapter discovered by the sync becomes once its pages are in.
     *
     * `ready` leaves it for a human to look at; `publish` puts it straight on the site. The
     * second is the point of the feature for most operators — a release appears without
     * anybody being awake — but it is a decision to opt into rather than a default, because
     * it hands a third party's file the ability to publish on this site.
     */
    publishMode: text('publish_mode').$type<'ready' | 'publish'>().notNull().default('ready'),
    isPremium: boolean('is_premium').notNull().default(false),
    /** Which group's version to take when the file offers several. Null means the first. */
    groupName: text('group_name'),
    /** Paused rather than deleted: the history below is worth keeping. */
    active: boolean('active').notNull().default(true),
    /**
     * Digest of the chapter list the last check saw.
     *
     * An unchanged manifest is the overwhelmingly common case — most checks of most sources
     * find nothing — so the digest lets a check stop after the fetch instead of querying the
     * chapter table for every source on every pass.
     */
    fingerprint: text('fingerprint'),
    lastCheckedAt: timestamptz('last_checked_at'),
    /** When the file last actually differed, which is what "is this still maintained" means. */
    lastChangedAt: timestamptz('last_changed_at'),
    /**
     * Why the last check failed, kept so the panel can say so.
     *
     * A sync that quietly stops working is worse than one that never existed: the operator
     * believes the site is current. Cleared by the next successful check.
     */
    lastError: text('last_error'),
    /** Chapters this source has imported, all-time. */
    imported: integer('imported').notNull().default(0),
    createdBy: ref('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One row per file per language: re-following a link already followed is an edit of the
    // row that exists, not a second row that imports the same chapters twice.
    unique('manifest_sources_series_url_lang_unique').on(t.seriesId, t.url, t.language),
    // The due query: active sources, oldest check first.
    index('manifest_sources_due_idx').on(t.lastCheckedAt).where(sql`${t.active}`),
  ],
)
