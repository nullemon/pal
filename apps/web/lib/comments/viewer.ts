import type { EntitlementRow, SessionUser } from '@palscans/core'
import { db, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { cache } from 'react'
import { getSessionUser } from '@/lib/auth/session'

/**
 * The viewer with the profile fields the comment pipeline and the series page need beyond
 * the lean `SessionUser` that `lib/auth` (P4) resolves: display name, avatar, account age
 * and the comment ban. One extra indexed read per request, memoised with React `cache`.
 */
export interface AppUser extends SessionUser {
  id: number
  username: string | null
  email: string
  emailVerifiedAt: Date | null
  displayName: string | null
  avatarKey: string | null
  createdAt: Date
  commentBannedUntil: Date | null
  entitlements: readonly EntitlementRow[]
}

export const appUserFromSession = async (session: SessionUser | null): Promise<AppUser | null> => {
  if (!session) return null
  const [row] = await db
    .select({
      email: users.email,
      username: users.username,
      emailVerifiedAt: users.emailVerifiedAt,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
      createdAt: users.createdAt,
      commentBannedUntil: users.commentBannedUntil,
    })
    .from(users)
    .where(eq(users.id, session.id))
    .limit(1)
  if (!row) return null
  return {
    id: session.id,
    role: session.role,
    username: row.username,
    email: row.email,
    emailVerifiedAt: row.emailVerifiedAt,
    displayName: row.displayName,
    avatarKey: row.avatarKey,
    createdAt: row.createdAt,
    commentBannedUntil: row.commentBannedUntil,
    entitlements: session.entitlements ?? [],
    // Carried through, or `can()` silently falls back to the compiled role bundle and the
    // operator's matrix in Admin → Access → Roles has no effect on anything reached from
    // here — including `DELETE /api/comments/:id`. It failed open in both directions: a
    // revoked `comment.moderate` still deleted, and a granted one still refused.
    permissions: session.permissions,
  }
}

/** The signed-in viewer for this request (null when anonymous), memoised per request. */
export const getAppUser = cache(
  async (): Promise<AppUser | null> => appUserFromSession(await getSessionUser()),
)
