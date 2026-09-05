import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core'
import { createdAt, identity, ref, timestamptz, updatedAt } from './_shared.js'
import { series } from './catalog.js'
import { citext } from './custom-types.js'
import { users } from './identity.js'

/**
 * Custom reading lists (docs/13 "Custom reading lists", docs/17 §G) — user-named shelves
 * beyond the five fixed `bookmarks` statuses. A list is private until its owner publishes
 * it, and a published one is readable at `/lists/{username}/{slug}` by anyone, signed in
 * or not, which is why the slug is unique per owner rather than globally.
 */
export const readingLists = pgTable(
  'reading_lists',
  {
    id: identity(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** URL segment, case-insensitive so `/lists/reader/Best-Of` and `best-of` are one list. */
    slug: citext('slug').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('reading_lists_user_id_slug_unique').on(t.userId, t.slug),
    index('reading_lists_user_idx').on(t.userId, t.updatedAt.desc()),
    index('reading_lists_public_idx').on(t.updatedAt.desc()).where(sql`${t.isPublic}`),
    check('reading_lists_name_check', sql`length(btrim(${t.name})) between 1 and 60`),
  ],
)

/**
 * Membership plus the owner's order. The primary key is what makes a series appear at most
 * once in a list; `position` is dense (0…n-1) and rewritten by `moveListItem`, so the order
 * is a property of the table rather than of whatever the UI last posted.
 */
export const readingListItems = pgTable(
  'reading_list_items',
  {
    listId: ref('list_id')
      .notNull()
      .references(() => readingLists.id, { onDelete: 'cascade' }),
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    addedAt: timestamptz('added_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.seriesId] }),
    index('reading_list_items_order_idx').on(t.listId, t.position),
    index('reading_list_items_series_idx').on(t.seriesId),
  ],
)
