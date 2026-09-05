import { bookmarks, chapters, seriesFollows } from '@palscans/db'
import { eq, sql } from 'drizzle-orm'
import { loadPrefs, type PrefRow, prefAllows } from './prefs'
import { DEFAULT_FOLLOW_MODE, type FollowMode, followAllows, isFollowMode } from './schema'
import type { NotifyDb } from './types'

/**
 * Who a new chapter goes to, and how loudly (docs/17 §D).
 *
 * Two rules, applied in this order:
 *
 *  1. **Follow, not bookmark.** `series_follows` is the subscription. It is an *override
 *     layer*: a bookmark with no row is still an implicit follow on `all`, which is exactly
 *     what every bookmarker had before the table existed — so nothing about this feature
 *     unsubscribes anyone, and `bookmarks` keeps its own meaning (a shelf) untouched.
 *  2. **The reader's global matrix still wins.** `followAllows` only says what this *series*
 *     may do; `prefAllows` says what this *channel* may do at all. A sender needs both.
 *
 * The functions that decide are pure and take rows, so the rule is unit-tested without a
 * database; the two loaders below are the only queries.
 */

export interface FollowerRow {
  userId: number
  mode: FollowMode
  /** `follow` — the reader wrote this row · `bookmark` — inherited from their shelf. */
  source: 'follow' | 'bookmark'
}

/**
 * Explicit follows layered over the bookmarks, which is the whole model in one function:
 * a row wins wherever it exists (including `off`), a bookmark without one means `all`.
 */
export const mergeFollowers = (
  follows: readonly { userId: number; mode: string }[],
  bookmarkedUserIds: readonly number[],
): FollowerRow[] => {
  const out = new Map<number, FollowerRow>()
  for (const userId of bookmarkedUserIds)
    out.set(userId, { userId, mode: DEFAULT_FOLLOW_MODE, source: 'bookmark' })
  for (const f of follows)
    out.set(f.userId, {
      userId: f.userId,
      mode: isFollowMode(f.mode) ? f.mode : DEFAULT_FOLLOW_MODE,
      source: 'follow',
    })
  return [...out.values()]
}

/** Everyone with a stake in this series — muted ones included, so a skip can be recorded. */
export const loadFollowers = async (db: NotifyDb, seriesId: number): Promise<FollowerRow[]> => {
  const [follows, marks] = await Promise.all([
    db
      .select({ userId: seriesFollows.userId, mode: seriesFollows.mode })
      .from(seriesFollows)
      .where(eq(seriesFollows.seriesId, seriesId)),
    db.select({ userId: bookmarks.userId }).from(bookmarks).where(eq(bookmarks.seriesId, seriesId)),
  ])
  return mergeFollowers(
    follows,
    marks.map((m) => m.userId),
  )
}

/** Why someone in the fan-out is not being sent to — the ledger's `detail`. */
export type SkipReason = 'series muted' | 'preference off'

export interface Recipients {
  allowed: number[]
  /** `[userId, reason]`, so the caller can write one honest ledger row per skip. */
  skipped: Array<{ userId: number; reason: SkipReason }>
}

/**
 * Split a set of followers into "send" and "skip, and here is why", for one channel. Pure —
 * `seriesRecipients` is this plus the two loads.
 */
export const splitRecipients = (
  followers: readonly FollowerRow[],
  prefs: readonly PrefRow[],
  kind: string,
  channel: string,
): Recipients => {
  const allowed: number[] = []
  const skipped: Recipients['skipped'] = []
  for (const f of followers) {
    if (!followAllows(f.mode, channel)) {
      skipped.push({ userId: f.userId, reason: 'series muted' })
      continue
    }
    if (!prefAllows(prefs, f.userId, kind, channel)) {
      skipped.push({ userId: f.userId, reason: 'preference off' })
      continue
    }
    allowed.push(f.userId)
  }
  return { allowed, skipped }
}

/** Who gets a `kind` notice about `seriesId` on `channel`, and who was passed over and why. */
export const seriesRecipients = async (
  db: NotifyDb,
  seriesId: number,
  kind: string,
  channel: string,
): Promise<Recipients> => {
  const followers = await loadFollowers(db, seriesId)
  if (followers.length === 0) return { allowed: [], skipped: [] }
  const prefs = await loadPrefs(
    db,
    followers.map((f) => f.userId),
  )
  return splitRecipients(followers, prefs, kind, channel)
}

/**
 * The digest's half of the same rule, as SQL: the series ids this reader wants in an email.
 *
 * Written as a `NOT EXISTS` over the *disallowing* modes rather than an `IN` over the
 * allowing ones, because the candidate set is a union of three sources (explicit follows,
 * bookmarks and reading progress) and a mute has to veto all three at once.
 */
export const digestMutedSeries = (userId: number) =>
  sql`not exists (
    select 1 from ${seriesFollows}
    where ${seriesFollows.userId} = ${userId}
      and ${seriesFollows.seriesId} = ${chapters.seriesId}
      and ${seriesFollows.mode} not in ('all', 'digest')
  )`

/** Series this reader explicitly follows *and* wants in the digest. */
export const digestFollowedSeries = (db: NotifyDb, userId: number) =>
  db
    .select({ seriesId: seriesFollows.seriesId })
    .from(seriesFollows)
    .where(sql`${seriesFollows.userId} = ${userId} and ${seriesFollows.mode} in ('all', 'digest')`)
