import { sql } from 'drizzle-orm'
import { boolean, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, identity, ref, timestamptz, updatedAt } from './_shared.js'
import { bytea } from './custom-types.js'
import { users } from './identity.js'

/**
 * Auto-posting to the operator's own social accounts (migration 9042).
 *
 * The split is the same one `notification_deliveries` makes against `push_subscriptions`:
 * `social_accounts` is who we are on each platform, `social_posts` is what happened. The
 * ledger outlives the account — disconnecting Bluesky must not erase the record of what it
 * posted — so the reference is SET NULL and `platform` is carried on every ledger row.
 */

/** The platforms an adapter exists for. Stored as text; validated in @palscans/core. */
export const SOCIAL_PLATFORMS = [
  'bluesky',
  'x',
  'reddit',
  'facebook',
  'instagram',
  'tiktok',
] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

/**
 * Per-account posting options, as the admin screen sets them.
 *
 * `linkPlacement` is the one that carries a real constraint rather than a preference.
 * "Link in the first comment" only works where the platform has a comment API we can call
 * as the author — Bluesky, X, Reddit, Facebook and Instagram do; TikTok does not. TikTok
 * therefore gets `bio`, which does not mean "we update the bio" (no API exposes that) but
 * "the link lives in a bio the operator sets once, pointing at /latest".
 */
export interface SocialAccountSettings {
  /** Post automatically when a chapter publishes, as opposed to compose-box only. */
  autoPost?: boolean
  linkPlacement?: 'comment' | 'body' | 'bio'
  /** Cover art, chapter pages, or no image at all. */
  media?: 'cover' | 'pages' | 'none'
  /** How many pages to attach where `media` is 'pages' (TikTok allows up to 35). */
  pageCount?: number
  /** Template override; falls back to the global template when absent. */
  template?: string
}

export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: identity(),
    platform: text('platform').$type<SocialPlatform>().notNull(),
    /** What the operator sees: `@palscans`, `r/palscans`, the Page name. */
    handle: text('handle').notNull(),
    /**
     * Sealed JSON (packages/core/src/secrets.ts), one blob rather than a column per field:
     * the six platforms share no credential shape, and a column per platform per field
     * would be mostly NULL plus a migration every time one changes its auth.
     */
    credentials: bytea('credentials').notNull(),
    /** Lifted out of the blob because the refresh sweep has to query for it. */
    tokenExpiresAt: timestamptz('token_expires_at'),
    active: boolean('active').notNull().default(true),
    settings: jsonb('settings').$type<SocialAccountSettings>().notNull().default({}),
    lastPostedAt: timestamptz('last_posted_at'),
    createdBy: ref('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('social_accounts_live_idx').on(t.platform).where(sql`${t.active}`),
    index('social_accounts_expiry_idx')
      .on(t.tokenExpiresAt)
      .where(sql`${t.tokenExpiresAt} IS NOT NULL AND ${t.active}`),
  ],
)

export const socialPosts = pgTable(
  'social_posts',
  {
    id: identity(),
    /** SET NULL, not cascade: history survives a disconnected account. */
    accountId: ref('account_id').references(() => socialAccounts.id, { onDelete: 'set null' }),
    /** Denormalised so a row stays readable once its account is gone. */
    platform: text('platform').$type<SocialPlatform>().notNull(),
    kind: text('kind').notNull(), // chapter | announcement | manual
    /** Loose refs, like notification_deliveries — prunable, and never block a deletion. */
    chapterId: ref('chapter_id'),
    seriesId: ref('series_id'),
    status: text('status').notNull(), // queued | sent | failed | skipped
    remoteId: text('remote_id'),
    permalink: text('permalink'),
    /** What this post actually said. The template can change; this cannot. */
    body: text('body'),
    detail: text('detail'),
    /** `chapter:412:bluesky` — see the unique index below. */
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    postedAt: timestamptz('posted_at'),
  },
  (t) => [
    index('social_posts_created_idx').on(t.createdAt.desc()),
    index('social_posts_platform_idx').on(t.platform, t.status, t.createdAt.desc()),
    index('social_posts_chapter_idx').on(t.chapterId).where(sql`${t.chapterId} IS NOT NULL`),
    /**
     * The double-post guard. A duplicate email is waste; a duplicate social post is public
     * and permanent, and the ways to get one are ordinary — a retried job, a worker restart
     * mid-publish, an operator pressing the button twice. In the database, no code path can
     * produce one, including code written later by someone who has not read this comment.
     *
     * Excluding `failed` is what keeps retries possible: a failure leaves a row behind and
     * the retry still has to insert. The guaranteed property is one *non-failed* row per
     * key — one successful post per chapter per platform, however many attempts it took.
     */
    uniqueIndex('social_posts_dedupe_unique')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL AND ${t.status} <> 'failed'`),
  ],
)
