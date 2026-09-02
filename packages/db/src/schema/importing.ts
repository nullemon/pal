import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { identity, ref, timestamptz } from './_shared.js'
import { users } from './identity.js'

/** Which pass the runner is on. They run in this order; each is resumable on its own cursor. */
export const IMPORT_PHASES = [
  'terms',
  'users',
  'series',
  'chapters',
  'bookmarks',
  'comments',
  'redirects',
  'done',
] as const
export type ImportPhase = (typeof IMPORT_PHASES)[number]

export const IMPORT_STATUSES = [
  'queued',
  'running',
  'paused',
  'done',
  'failed',
  'cancelled',
] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

/** Where each phase resumes. A phase reads only its own key and ignores the rest. */
export interface ImportCursor {
  /** Last legacy `post_id` whose series row is fully written. */
  seriesPostId?: number
  /** Series being walked in the chapter phase, and the last chapter id finished inside it. */
  chapterSeriesPostId?: number
  chapterId?: number
  userId?: number
  bookmarkPostId?: number
  commentId?: number
  termId?: number
}

/** Running totals, shown live on the admin screen. */
export interface ImportCounts {
  terms?: number
  users?: number
  series?: number
  chapters?: number
  pages?: number
  bookmarks?: number
  comments?: number
  redirects?: number
  /** Rows an earlier run already wrote unchanged — proof the re-run was idempotent. */
  skipped?: number
}

export interface ImportRunError {
  at: string
  scope: string
  message: string
}

/**
 * One import run (docs/09, docs/17 §E). The row *is* the checkpoint: every batch commits its
 * writes and its cursor together, so a killed worker resumes from the last committed batch
 * rather than starting over. `pause_requested` / `cancel_requested` are read between batches,
 * which is why stopping an import never leaves a half-written chapter behind.
 */
export const importRuns = pgTable(
  'import_runs',
  {
    id: identity(),
    /** The source label as the report shows it — any DSN password is masked before it lands here. */
    source: text('source').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').$type<ImportStatus>().notNull().default('queued'),
    phase: text('phase').$type<ImportPhase>().notNull().default('terms'),
    cursor: jsonb('cursor').$type<ImportCursor>().notNull().default({}),
    counts: jsonb('counts').$type<ImportCounts>().notNull().default({}),
    errors: jsonb('errors').$type<ImportRunError[]>().notNull().default([]),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    pauseRequested: boolean('pause_requested').notNull().default(false),
    startedBy: ref('started_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** Bumped every batch; a run whose heartbeat has gone cold is offered for takeover. */
    heartbeatAt: timestamptz('heartbeat_at'),
    finishedAt: timestamptz('finished_at'),
  },
  (t) => [
    index('import_runs_started_at_idx').on(t.startedAt.desc()),
    // At most one live run: a second Start is refused by the database, not by a race-prone check.
    uniqueIndex('import_runs_live_unique')
      .on(sql`(1)`)
      .where(sql`${t.status} in ('queued', 'running', 'paused')`),
  ],
)

export const IMPORT_MAP_KINDS = [
  'series',
  'chapter',
  'user',
  'genre',
  'person',
  'comment',
  'bookmark',
] as const
export type ImportMapKind = (typeof IMPORT_MAP_KINDS)[number]

/**
 * Legacy id → local id. This table is what makes the import idempotent: a re-run looks a
 * legacy row up here and updates the mapped row instead of inserting a duplicate, and skips
 * it entirely when `digest` shows the mapped payload has not changed. It outlives the run.
 */
export const importMap = pgTable(
  'import_map',
  {
    kind: text('kind').$type<ImportMapKind>().notNull(),
    legacyId: bigint('legacy_id', { mode: 'number' }).notNull(),
    targetId: bigint('target_id', { mode: 'number' }).notNull(),
    digest: text('digest'),
    importedAt: timestamptz('imported_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.legacyId] }),
    index('import_map_target_idx').on(t.kind, t.targetId),
  ],
)
