import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
} from 'drizzle-orm/pg-core'
import { createdAt, deletedAt, identity, ref, timestamptz } from './_shared.js'
import { series } from './catalog.js'
import { chapters } from './chapters.js'
import { bytea, citext } from './custom-types.js'
import { commentStatus } from './enums.js'
import { users } from './identity.js'

/** Structured comment body — see `CommentBody` in @palscans/core. Never raw HTML. */
export type CommentBodyJson = { type: 'doc'; version: 1; children: readonly unknown[] }

export type ReactionKind = 'up' | 'funny' | 'love' | 'surprised' | 'angry' | 'sad'

export const comments = pgTable(
  'comments',
  {
    id: identity(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seriesId: ref('series_id').references(() => series.id, { onDelete: 'cascade' }),
    chapterId: ref('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }),
    parentId: bigint('parent_id', { mode: 'number' }).references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    body: jsonb('body').$type<CommentBodyJson>().notNull(),
    isSpoiler: boolean('is_spoiler').notNull().default(false),
    isPinned: boolean('is_pinned').notNull().default(false),
    score: integer('score').notNull().default(0),
    // docs/14 §7
    status: commentStatus('status').notNull().default('published'),
    automodScore: smallint('automod_score').notNull().default(0),
    automodRules: text('automod_rules').array().notNull().default(sql`'{}'::text[]`),
    hasLink: boolean('has_link').notNull().default(false),
    imageId: bigint('image_id', { mode: 'number' }), // community_images.id
    ipHash: bytea('ip_hash'),
    locked: boolean('locked').notNull().default(false),
    // denormalised, reconciled nightly (docs/14 §9)
    reactionCounts: jsonb('reaction_counts')
      .$type<Partial<Record<ReactionKind, number>>>()
      .notNull()
      .default({}),
    replyCount: integer('reply_count').notNull().default(0),
    editedAt: timestamptz('edited_at'),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('comments_target_check', sql`${t.seriesId} IS NOT NULL OR ${t.chapterId} IS NOT NULL`),
    index('comments_chapter_created_idx')
      .on(t.chapterId, t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    index('comments_series_score_idx')
      .on(t.seriesId, t.score.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    index('comments_parent_idx').on(t.parentId, t.createdAt),
    index('comments_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('comments_moderation_idx')
      .on(t.status, t.createdAt.desc())
      .where(sql`${t.status} IN ('pending', 'shadow')`),
  ],
)

export const commentReactions = pgTable(
  'comment_reactions',
  {
    commentId: ref('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // up|funny|love|surprised|angry|sad
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId, t.kind] })],
)

/** One queue for every report type. */
export const reports = pgTable(
  'reports',
  {
    id: identity(),
    kind: text('kind').notNull(), // comment|series_data|broken_chapter|site|dmca|request|contact
    targetType: text('target_type').notNull(),
    targetId: bigint('target_id', { mode: 'number' }),
    reporterId: ref('reporter_id').references(() => users.id),
    reporterEmail: citext('reporter_email'), // DMCA notices come from non-users
    reason: text('reason').notNull(),
    detail: text('detail'),
    payload: jsonb('payload').$type<Record<string, unknown>>(), // e.g. { page_idx } for broken_chapter
    status: text('status').notNull().default('open'), // open|triaged|actioned|rejected
    handledBy: ref('handled_by').references(() => users.id),
    handledAt: timestamptz('handled_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('reports_status_kind_created_idx').on(t.status, t.kind, t.createdAt),
    index('reports_target_idx').on(t.targetType, t.targetId),
  ],
)

export const commentEdits = pgTable('comment_edits', {
  id: identity(),
  commentId: ref('comment_id')
    .notNull()
    .references(() => comments.id, { onDelete: 'cascade' }),
  editorId: ref('editor_id')
    .notNull()
    .references(() => users.id),
  body: jsonb('body').$type<CommentBodyJson>().notNull(), // the previous body
  editedAt: timestamptz('edited_at').notNull().defaultNow(),
})

export const commentMentions = pgTable(
  'comment_mentions',
  {
    commentId: ref('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
)

export const userBlocks = pgTable(
  'user_blocks',
  {
    blockerId: ref('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: ref('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })],
)

export const communityImages = pgTable(
  'community_images',
  {
    id: identity(),
    key: text('key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    uploadedBy: ref('uploaded_by').references(() => users.id),
    status: text('status').notNull().default('pending'), // pending | approved | removed
    isCollection: boolean('is_collection').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('community_images_tags_idx').using('gin', t.tags).where(sql`${t.status} = 'approved'`),
  ],
)

export const wordFilters = pgTable('word_filters', {
  id: identity(),
  pattern: text('pattern').notNull(), // literal or regex
  isRegex: boolean('is_regex').notNull().default(false),
  action: text('action').notNull(), // block | hold | replace
  replacement: text('replacement'),
  createdBy: ref('created_by').references(() => users.id),
  createdAt: createdAt(),
})

export const linkAllowlist = pgTable('link_allowlist', {
  domain: citext('domain').primaryKey(),
  createdBy: ref('created_by').references(() => users.id),
  createdAt: createdAt(),
})

/** Singleton key/value like seo_settings. */
export const commentSettings = pgTable('comment_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})
