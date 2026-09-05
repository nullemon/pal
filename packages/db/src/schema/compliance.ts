import { char, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { identity, ref, timestamptz } from './_shared.js'
import { series } from './catalog.js'
import { chapters } from './chapters.js'
import { citext } from './custom-types.js'
import { users } from './identity.js'

/**
 * The DMCA ledger (docs/02 "Content compliance", docs/07). One row per notice received
 * through the `/dmca` form, and the record of what was done about it — the thing a
 * safe-harbour claim is argued from, so it is written on intake and never deleted.
 *
 * Lifecycle, read off two columns and nothing else:
 *
 *   received   `action IS NULL`                        — the 48h clock is running
 *   acknowledged `action = 'acknowledged'`, `actioned_at IS NULL` — seen, still open
 *   closed     `action` set, `actioned_at` set         — 'removed' | 'geo_blocked' | 'rejected'
 *
 * The staff note attached to each transition lives in the `audit_log` row the action writes
 * (`takedown.*`, target type `takedown`), which is where the rest of the panel keeps the
 * "who did what and why" of a mutation.
 */
export const takedowns = pgTable('takedowns', {
  id: identity(),
  seriesId: ref('series_id').references(() => series.id),
  chapterId: ref('chapter_id').references(() => chapters.id),
  claimant: text('claimant').notNull(),
  claimantEmail: citext('claimant_email').notNull(),
  noticeBody: text('notice_body').notNull(),
  receivedAt: timestamptz('received_at').notNull().defaultNow(),
  actionedAt: timestamptz('actioned_at'),
  action: text('action'), // 'acknowledged' | 'removed' | 'geo_blocked' | 'rejected'
  counterNotice: text('counter_notice'),
  /** The staff member who last actioned it; null while the notice is untouched. */
  createdBy: ref('created_by').references(() => users.id),
})

/** Per-title territory control. */
export const geoRestrictions = pgTable(
  'geo_restrictions',
  {
    seriesId: ref('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    country: char('country', { length: 2 }).notNull(),
    mode: text('mode').notNull(), // 'allow' | 'block'
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.country] })],
)
