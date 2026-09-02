import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { createdAt, identity, ref, timestamptz } from './_shared.js'
import { bytea, citext } from './custom-types.js'
import { users } from './identity.js'

/** Web Push subscriptions (docs/13 notifications). */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: identity(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastUsedAt: timestamptz('last_used_at'),
    failedAt: timestamptz('failed_at'),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
)

/** Per channel (in_app · push · email · discord) × per kind (new_chapter · reply · reaction · announcement). */
export const notificationPrefs = pgTable(
  'notification_prefs',
  {
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.channel] })],
)

/** User, email, IP and ASN bans with reasons and expiry. */
export const bans = pgTable(
  'bans',
  {
    id: identity(),
    kind: text('kind').notNull(), // user | email | ip | asn
    value: citext('value').notNull(), // user id, email, hashed ip or asn
    userId: ref('user_id').references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    expiresAt: timestamptz('expires_at'),
    createdBy: ref('created_by').references(() => users.id),
    createdAt: createdAt(),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [index('bans_kind_value_idx').on(t.kind, t.value).where(sql`${t.revokedAt} IS NULL`)],
)

/** Outgoing webhooks on chapter.published, series.created … */
export const webhooks = pgTable('webhooks', {
  id: identity(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: text('events').array().notNull().default(sql`'{}'::text[]`),
  active: boolean('active').notNull().default(true),
  lastStatus: text('last_status'),
  lastDeliveredAt: timestamptz('last_delivered_at'),
  createdBy: ref('created_by').references(() => users.id),
  createdAt: createdAt(),
})

/** Keys for the Discord bot and future apps; only the hash is stored. */
export const apiKeys = pgTable('api_keys', {
  id: identity(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(), // first 8 chars, for display
  keyHash: bytea('key_hash').notNull().unique(),
  userId: ref('user_id').references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
  lastUsedAt: timestamptz('last_used_at'),
  expiresAt: timestamptz('expires_at'),
  revokedAt: timestamptz('revoked_at'),
  createdAt: createdAt(),
})
