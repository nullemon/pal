import { sql } from 'drizzle-orm'
import { boolean, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, identity, ref, timestamptz } from './_shared.js'
import { users } from './identity.js'

/** The full appearance document (docs/15). Kept loose here; the resolver owns the shape. */
export type AppearanceDocument = Record<string, unknown>

export const appearanceSettings = pgTable(
  'appearance_settings',
  {
    id: identity(),
    settings: jsonb('settings').$type<AppearanceDocument>().notNull(),
    resolvedCss: text('resolved_css').notNull(), // the derived token block, cached
    status: text('status').notNull().default('draft'), // draft | published | archived
    publishedAt: timestamptz('published_at'),
    createdBy: ref('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('appearance_settings_published_idx')
      .on(t.status)
      .where(sql`${t.status} = 'published'`),
  ],
)

export const themePresets = pgTable('theme_presets', {
  id: identity(),
  name: text('name').notNull(),
  settings: jsonb('settings').$type<AppearanceDocument>().notNull(),
  isBuiltin: boolean('is_builtin').notNull().default(false),
  createdBy: ref('created_by').references(() => users.id),
  createdAt: createdAt(),
})
