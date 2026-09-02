import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createdAt, deletedAt, identity, ref, timestamptz, updatedAt } from './_shared.js'
import { bytea, citext } from './custom-types.js'
import { userRole } from './enums.js'

export const users = pgTable(
  'users',
  {
    id: identity(),
    email: citext('email').notNull().unique(),
    username: citext('username').unique(), // null until onboarding completes
    passwordHash: text('password_hash'), // null for OAuth-only accounts
    role: userRole('role').notNull().default('user'),
    displayName: text('display_name'),
    bio: text('bio'),
    avatarKey: text('avatar_key'), // object key, not a URL
    bannerKey: text('banner_key'),
    emailVerifiedAt: timestamptz('email_verified_at'),
    commentBannedUntil: timestamptz('comment_banned_until'),
    lastLoginAt: timestamptz('last_login_at'),
    lastLoginMethod: text('last_login_method'),
    safeMode: boolean('safe_mode').notNull().default(false), // docs/13 content safety
    // P4 (migration 9004): optional TOTP, username-change cooldown, deletion grace period
    totpSecret: text('totp_secret'), // base32, set during enrolment; enabled once confirmed
    totpEnabledAt: timestamptz('totp_enabled_at'),
    usernameChangedAt: timestamptz('username_changed_at'), // docs/13: once per 30 days
    deletionRequestedAt: timestamptz('deletion_requested_at'), // docs/13: 14-day grace
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('users_role_idx').on(t.role).where(sql`${t.deletedAt} IS NULL`),
    index('users_deletion_requested_idx')
      .on(t.deletionRequestedAt)
      .where(sql`${t.deletionRequestedAt} IS NOT NULL`),
  ],
)

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: identity(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'google' | 'discord'
    providerUid: text('provider_uid').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('oauth_accounts_provider_uid_unique').on(t.provider, t.providerUid)],
)

/** Opaque server-side sessions; only sha256(secret) is stored (docs/07). */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    secretHash: bytea('secret_hash').notNull(),
    userAgent: text('user_agent'),
    ipHash: bytea('ip_hash'),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    lastSeenAt: timestamptz('last_seen_at'), // P4 (migration 9004): security page "last seen"
    createdAt: createdAt(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId).where(sql`${t.revokedAt} IS NULL`),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
)

/** Email verification + password reset tokens. */
export const authTokens = pgTable('auth_tokens', {
  id: identity(),
  userId: ref('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(), // 'verify_email' | 'reset_password'
  tokenHash: bytea('token_hash').notNull().unique(),
  expiresAt: timestamptz('expires_at').notNull(),
  consumedAt: timestamptz('consumed_at'),
  createdAt: createdAt(),
})
