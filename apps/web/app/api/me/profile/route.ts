import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { ok, parseJson, requireUser } from '@/lib/auth'
import { profileSchema } from '@/lib/auth/schemas'

/** PATCH /api/me/profile {displayName?, bio?, safeMode?} */
export const PATCH = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, profileSchema)
  if (!parsed.ok) return parsed.response
  const { displayName, bio, safeMode } = parsed.data
  const db = await getDb()
  await db
    .update(users)
    .set({
      ...(displayName !== undefined ? { displayName: displayName || null } : {}),
      ...(bio !== undefined ? { bio: bio || null } : {}),
      ...(safeMode !== undefined ? { safeMode } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
  return ok({ saved: true })
})
