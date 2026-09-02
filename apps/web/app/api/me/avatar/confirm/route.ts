import { messages } from '@palscans/core/messages'
import { getStorage } from '@palscans/core/storage'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { fail, ok, parseJson, requireUser } from '@/lib/auth'
import { avatarUrl } from '@/lib/auth/media'
import { avatarConfirmSchema } from '@/lib/auth/schemas'

/** POST /api/me/avatar/confirm {key} — after the upload landed, point the profile at it. */
export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, avatarConfirmSchema)
  if (!parsed.ok) return parsed.response
  const { key } = parsed.data
  if (!key.startsWith(`avatars/${user.id}/`))
    return fail(403, 'forbidden', messages.errors.forbidden)
  const storage = await getStorage()
  if (!(await storage.exists(key))) return fail(404, 'not_found', messages.errors.notFound)
  const db = await getDb()
  const [prev] = await db
    .select({ avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)
  await db.update(users).set({ avatarKey: key, updatedAt: new Date() }).where(eq(users.id, user.id))
  if (prev?.avatarKey && prev.avatarKey !== key)
    await storage.delete(prev.avatarKey).catch(() => undefined)
  return ok({ key, url: avatarUrl(key), message: messages.me.settings.avatarUploaded })
})
