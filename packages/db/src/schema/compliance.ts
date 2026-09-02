import { char, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { identity, ref, timestamptz } from './_shared.js'
import { series } from './catalog.js'
import { chapters } from './chapters.js'
import { citext } from './custom-types.js'
import { users } from './identity.js'

export const takedowns = pgTable('takedowns', {
  id: identity(),
  seriesId: ref('series_id').references(() => series.id),
  chapterId: ref('chapter_id').references(() => chapters.id),
  claimant: text('claimant').notNull(),
  claimantEmail: citext('claimant_email').notNull(),
  noticeBody: text('notice_body').notNull(),
  receivedAt: timestamptz('received_at').notNull().defaultNow(),
  actionedAt: timestamptz('actioned_at'),
  action: text('action'), // 'removed' | 'geo_blocked' | 'rejected'
  counterNotice: text('counter_notice'),
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
