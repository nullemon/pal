import { getDb, slugHistory, users } from '@palscans/db'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { RESERVED_USERNAMES } from './schemas'

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
