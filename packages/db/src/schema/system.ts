import { sql } from 'drizzle-orm'
import { bigint, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAt, deletedAt, identity, ref, timestamptz } from './_shared.js'
import { bytea, citext } from './custom-types.js'
import { pubState } from './enums.js'
import { users } from './identity.js'

export type RichTextJson = { type: 'doc'; children: readonly unknown[] }

export const announcements = pgTable('announcements', {
  id: identity(),
  slug: citext('slug').notNull().unique(),
  title: text('title').notNull(),
  body: jsonb('body').$type<RichTextJson>().notNull(),
  excerpt: text('excerpt'),
  coverKey: text('cover_key'),
  authorId: ref('author_id').references(() => users.id),
  state: pubState('state').notNull().default('draft'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`), // e.g. 'changelog'
  publishedAt: timestamptz('published_at'),
  createdAt: createdAt(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})

export const notifications = pgTable(
  'notifications',
  {
    id: identity(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // new_chapter|reply|mention|reaction|announcement|system
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    groupKey: text('group_key'), // collapses "12 people liked your comment"
    readAt: timestamptz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_unread_idx')
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.readAt} IS NULL`),
    index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: identity(),
    actorId: ref('actor_id').references(() => users.id),
    action: text('action').notNull(), // 'chapter.delete', 'user.role_change'
    targetType: text('target_type').notNull(),
    targetId: bigint('target_id', { mode: 'number' }),
    before: jsonb('before').$type<unknown>(),
    after: jsonb('after').$type<unknown>(),
    ipHash: bytea('ip_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_target_idx').on(t.targetType, t.targetId, t.createdAt.desc()),
    index('audit_log_actor_idx').on(t.actorId, t.createdAt.desc()),
    // "who did what in this window" — Admin → Queue health counts moderator actions with
    // `action LIKE 'report.%'` over a date range, which without this is a sequential scan
    // of every row ever written. `action` first so the prefix match narrows before the
    // range does (migration 9025).
    index('audit_log_action_created_idx').on(t.action, t.createdAt.desc()),
  ],
)

/** Legal / help rich-text pages, versioned (docs/13). */
export const pages = pgTable('pages', {
  id: identity(),
  slug: citext('slug').notNull().unique(),
  title: text('title').notNull(),
  body: jsonb('body').$type<RichTextJson>().notNull(),
  state: pubState('state').notNull().default('published'),
  version: bigint('version', { mode: 'number' }).notNull().default(1),
  updatedBy: ref('updated_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})

/**
 * Generic key/value settings (docs/04, 13): `layouts`, `ads`, `comments`, `site`, `menus`,
 * `home_layout`, `registration`, `maintenance`, `analytics`, `email_templates` …
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedBy: ref('updated_by').references(() => users.id),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: text('enabled').notNull().default('off'), // off | on | percentage
  percentage: bigint('percentage', { mode: 'number' }).notNull().default(0),
  description: text('description'),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  deletedAt: deletedAt(),
})
