import { messages } from '@palscans/core/messages'
import { comments, getDb, oauthAccounts, pushSubscriptions, slugHistory, users } from '@palscans/db'
import { and, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm'
import { RESERVED_USERNAMES } from './schemas'
import { revokeAllSessions } from './session'

export { type ActiveBan, activeUserBan } from './bans'

export const USERNAME_CHANGE_DAYS = 30
export const USERNAME_RESERVE_DAYS = 90
export const DELETION_GRACE_DAYS = 14

export const findUserByEmail = async (email: string) => {
  const db = await getDb()
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  return row ?? null
}

export const findUserById = async (id: number) => {
  const db = await getDb()
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return row ?? null
}

export type UsernameAvailability = 'ok' | 'taken' | 'reserved'

/**
 * docs/13: a username must be unused, not reserved, and not recently released by another
 * account (old names sit in `slug_history` for 90 days so profile links keep resolving).
 */
export const usernameAvailability = async (
  username: string,
  forUserId?: number,
): Promise<UsernameAvailability> => {
  if (RESERVED_USERNAMES.has(username.toLowerCase())) return 'reserved'
  const db = await getDb()
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
  if (taken && taken.id !== forUserId) return 'taken'
  const since = new Date(Date.now() - USERNAME_RESERVE_DAYS * 86_400_000)
  const [held] = await db
    .select({ entityId: slugHistory.entityId })
    .from(slugHistory)
    .where(
      and(
        eq(slugHistory.entityType, 'user'),
        eq(slugHistory.oldSlug, username),
        gt(slugHistory.createdAt, since),
      ),
    )
    .limit(1)
  if (held && held.entityId !== forUserId) return 'reserved'
  return 'ok'
}

/** When the user may next change their name (null = now). */
export const nextUsernameChangeAt = (changedAt: Date | null): Date | null => {
  if (!changedAt) return null
  const next = new Date(changedAt.getTime() + USERNAME_CHANGE_DAYS * 86_400_000)
  return next.getTime() > Date.now() ? next : null
}

/** Change a username: records the old one in slug_history (profile URL redirect + reservation). */
export const changeUsername = async (userId: number, username: string): Promise<void> => {
  const db = await getDb()
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ username: users.username })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)
    if (!current) throw new Error('user not found')
    await tx
      .update(users)
      .set({
        username,
        usernameChangedAt: current.username ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
    if (current.username && current.username.toLowerCase() !== username.toLowerCase()) {
      await tx
        .insert(slugHistory)
        .values({ entityType: 'user', oldSlug: current.username, entityId: userId })
        .onConflictDoUpdate({
          target: [slugHistory.entityType, slugHistory.oldSlug],
          set: { entityId: userId, createdAt: new Date() },
        })
    }
  })
}

/** Deletion runs after the grace period (a worker job purges); until then it can be cancelled. */
export const deletionPurgeAt = (requestedAt: Date | null): Date | null =>
  requestedAt ? new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * 86_400_000) : null

/**
 * Complete account deletions whose 14-day grace period has elapsed (docs/13). Meant to be
 * called by the worker's scheduled job (see README). For each due user, in one transaction:
 * - comments are anonymised, not removed — `comments.user_id` is NOT NULL, so the rows keep
 *   pointing at the user, which becomes a PII-free tombstone (`username` null, display name
 *   "Deleted user", no bio/avatar/banner); the per-comment `ip_hash` is cleared
 * - email (NOT NULL, unique) is replaced by `deleted-<id>@deleted.invalid`; username,
 *   password_hash, avatar_key, banner_key, totp_secret, bio and display name are wiped
 * - oauth_accounts and push_subscriptions are deleted
 * - deleted_at is set; then every session is revoked (also drops the Redis cache).
 * Returns the ids of purged users.
 */
export const purgeDueDeletions = async (now: Date = new Date()): Promise<number[]> => {
  const db = await getDb()
  const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * 86_400_000)
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNotNull(users.deletionRequestedAt),
        lte(users.deletionRequestedAt, cutoff),
        isNull(users.deletedAt),
      ),
    )
  const purged: number[] = []
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      // Re-check inside the transaction so a cancellation racing the job wins.
      const [row] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, id),
            isNotNull(users.deletionRequestedAt),
            lte(users.deletionRequestedAt, cutoff),
            isNull(users.deletedAt),
          ),
        )
        .for('update')
      if (!row) return
      await tx.update(comments).set({ ipHash: null }).where(eq(comments.userId, id))
      await tx.delete(oauthAccounts).where(eq(oauthAccounts.userId, id))
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, id))
      await tx
        .update(users)
        .set({
          email: `deleted-${id}@deleted.invalid`,
          username: null,
          passwordHash: null,
          displayName: messages.me.settings.deletedUser,
          bio: null,
          avatarKey: null,
          bannerKey: null,
          totpSecret: null,
          totpEnabledAt: null,
          emailVerifiedAt: null,
          lastLoginMethod: null,
          deletedAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, id))
      purged.push(id)
    })
    await revokeAllSessions(id)
  }
  return purged
}
