import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { createdAt, identity, ref, timestamptz } from './_shared.js'
import { citext } from './custom-types.js'
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

/*
 * `api_keys` lives in `./system.ts`. It was dropped in migration 9017 and brought back in
 * 9040, and the condition 9017 set for its return was met: the table returned in the same
 * change as the middleware that checks it (`apps/web/lib/auth/api-keys.ts` and the bearer
 * branch in `withPermission`), plus the screen that issues and revokes — Admin → System →
 * Remote.
 *
 * The `INTERNAL_API_SECRET` bearer is unchanged and still what the worker's
 * `/api/internal/*` calls and the Discord bot's redeem endpoint use. A key and that secret
 * never meet: `parseApiKey` only recognises `pal_`-prefixed tokens, so anything else falls
 * straight through to the path it always took.
 */

/**
 * D · Notifications (docs/17 §D). One row per attempted send on every channel — the ledger
 * `Admin → Community → Notifications` reads for "recent sends and failures", and the
 * idempotency key the worker uses so a chapter is never pushed twice.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: identity(),
    userId: ref('user_id').references(() => users.id, { onDelete: 'cascade' }),
    notificationId: ref('notification_id'), // notifications.id, kept loose (rows are prunable)
    kind: text('kind').notNull(), // new_chapter | reply | reaction | announcement | test
    channel: text('channel').notNull(), // push | email | discord
    status: text('status').notNull(), // sent | failed | skipped
    /** Non-identifying handle: push endpoint host, mail domain, webhook name, Discord id. */
    target: text('target'),
    detail: text('detail'),
    /** Collapses a fan-out into one idempotency key, e.g. `chapter:412:push`. */
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notification_deliveries_created_idx').on(t.createdAt.desc()),
    index('notification_deliveries_channel_idx').on(t.channel, t.status, t.createdAt.desc()),
    index('notification_deliveries_user_idx').on(t.userId, t.createdAt.desc()),
    index('notification_deliveries_dedupe_idx').on(t.dedupeKey),
  ],
)

/**
 * Per-user Discord account link (docs/17 §D). The reader generates a code on
 * `/me/notifications`, types it at the bot, and the bot redeems it — leaving the Discord
 * snowflake here. Everything is inert without `DISCORD_BOT_TOKEN`.
 */
export const discordLinks = pgTable(
  'discord_links',
  {
    userId: ref('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    discordId: text('discord_id').unique(),
    discordUsername: text('discord_username'),
    code: text('code').unique(),
    codeExpiresAt: timestamptz('code_expires_at'),
    linkedAt: timestamptz('linked_at'),
    rolesSyncedAt: timestamptz('roles_synced_at'),
    syncedRoles: text('synced_roles').array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('discord_links_code_idx').on(t.code).where(sql`${t.code} IS NOT NULL`)],
)

/**
 * Email digest opt-in and its cursor (docs/17 §D). `frequency` is the reader's choice on
 * `/me/notifications`; `lastCursorAt` is the watermark the assembler reads from, so a digest
 * never repeats a chapter and a missed run catches up rather than skipping.
 */
export const notificationDigestState = pgTable('notification_digest_state', {
  userId: ref('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  frequency: text('frequency').notNull().default('off'), // off | daily | weekly
  lastSentAt: timestamptz('last_sent_at'),
  lastCursorAt: timestamptz('last_cursor_at'),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})
