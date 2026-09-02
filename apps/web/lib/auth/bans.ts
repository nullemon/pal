import { bans, getDb } from '@palscans/db'
import { and, eq, gt, isNull, or } from 'drizzle-orm'

export interface ActiveBan {
  id: number
  reason: string | null
  expiresAt: Date | null
}

/**
 * The user's active account ban (`bans.kind = 'user'`, not revoked, not expired), or null.
 * Consulted by `loadSessionUser` (so a ban ends every session at once) and by every
 * sign-in path before a session is minted (docs/07).
 */
export const activeUserBan = async (
  userId: number,
  now: Date = new Date(),
): Promise<ActiveBan | null> => {
  const db = await getDb()
  const [row] = await db
    .select({ id: bans.id, reason: bans.reason, expiresAt: bans.expiresAt })
    .from(bans)
    .where(
      and(
        eq(bans.kind, 'user'),
        eq(bans.value, String(userId)),
        isNull(bans.revokedAt),
        or(isNull(bans.expiresAt), gt(bans.expiresAt, now)),
      ),
    )
    .limit(1)
  return row ?? null
}
