import { bigint, integer, jsonb, pgTable, primaryKey, smallint, text } from 'drizzle-orm/pg-core'
import { createdAt, deletedAt, identity, ref, timestamptz } from './_shared.js'
import { citext } from './custom-types.js'
import { users } from './identity.js'

/** Singleton key/value, cached in Redis, admin-edited (docs/12 §9). */
export const seoSettings = pgTable('seo_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedBy: ref('updated_by').references(() => users.id),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})

/** Slugs never break links: renaming writes the old slug here and the router 301s. */
export const slugHistory = pgTable(
  'slug_history',
  {
    entityType: text('entity_type').notNull(), // 'series' | 'genre' | 'announcement' | 'user'
    oldSlug: citext('old_slug').notNull(),
    entityId: bigint('entity_id', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.entityType, t.oldSlug] })],
)

export const redirects = pgTable('redirects', {
  id: identity(),
  fromPath: text('from_path').notNull().unique(),
  toPath: text('to_path').notNull(),
  status: smallint('status').notNull().default(301),
  hits: bigint('hits', { mode: 'number' }).notNull().default(0),
  createdBy: ref('created_by').references(() => users.id),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
})

export interface SitemapFile {
  name: string
  urls: number
  bytes: number
}

export const sitemapBuilds = pgTable('sitemap_builds', {
  id: identity(),
  kind: text('kind').notNull(), // 'full' | 'incremental'
  urlCount: integer('url_count').notNull(),
  files: jsonb('files').$type<SitemapFile[]>().notNull(),
  error: text('error'),
  startedAt: timestamptz('started_at').notNull(),
  finishedAt: timestamptz('finished_at'),
})
