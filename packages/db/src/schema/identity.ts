import { sql } from 'drizzle-orm'
import { boolean, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
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
    /**
     * Legacy raw base32. Nothing writes it any more (migration 9036): enrolment writes
     * `totpSecretSealed`, and a row still holding plaintext is re-sealed in place the next
     * time that account passes its second factor. Read through `totpSecretOf()` in
     * `apps/web/lib/auth/totp.ts`, never directly — reading this column alone silently
     * misses every account enrolled since 9036.
     */
    totpSecret: text('totp_secret'),
    /** The same secret sealed with CREDENTIALS_KEY (packages/core/src/secrets.ts). */
    totpSecretSealed: bytea('totp_secret_sealed'),
    /**
     * Highest 30-second TOTP step this account has spent (migration 9036). A code is
     * single-use: accepting one is a compare-and-set on this column, so the ±1-step drift
     * window cannot be replayed.
     */
    totpLastStep: integer('totp_last_step'),
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

/**
 * docs/17 §C — invite codes, used by the register route when `settings.site.registration`
 * is `invite`. Single- or multi-use with an optional expiry; revoked, never deleted.
 */
export const inviteCodes = pgTable(
  'invite_codes',
  {
    id: identity(),
    code: citext('code').notNull().unique(),
    maxUses: integer('max_uses').notNull().default(1),
    uses: integer('uses').notNull().default(0),
    note: text('note'),
    expiresAt: timestamptz('expires_at'),
    lastUsedAt: timestamptz('last_used_at'),
    createdBy: ref('created_by').references(() => users.id),
    createdAt: createdAt(),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [index('invite_codes_created_idx').on(t.createdAt.desc())],
)
