import { sql } from 'drizzle-orm'
import { boolean, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, identity, ref, timestamptz } from './_shared.js'
import { users } from './identity.js'

/** The full appearance document (docs/15). Kept loose here; the resolver owns the shape. */
export type AppearanceDocument = Record<string, unknown>

/**
 * One version stream per Appearance screen (docs/15 "Presets, preview, history").
 *
 * `scope` is what lets Brand, Menus and Copy share this table with the theme instead of
 * growing a second, parallel versioning system. The app owns the vocabulary — the column is
 * plain `text` so a screen can be added without a migration, and so the admin's *client*
 * components can name a scope without importing this package.
 *
 * The two partial unique indexes are the invariant: one published row and one draft row per
 * scope. See `drizzle/9033_appearance_scopes.sql` for why the draft one is not optional.
 */
export const appearanceSettings = pgTable(
  'appearance_settings',
  {
    id: identity(),
    scope: text('scope').notNull().default('theme'), // theme | brand | menus | copy
    settings: jsonb('settings').$type<AppearanceDocument>().notNull(),
    resolvedCss: text('resolved_css').notNull(), // the derived token block, cached (theme only)
    status: text('status').notNull().default('draft'), // draft | published | archived
    publishedAt: timestamptz('published_at'),
    createdBy: ref('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('appearance_settings_published_idx')
      .on(t.scope)
      .where(sql`${t.status} = 'published'`),
    uniqueIndex('appearance_settings_draft_idx').on(t.scope).where(sql`${t.status} = 'draft'`),
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
