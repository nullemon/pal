import { messages } from '@palscans/core/messages'
import { getStorage } from '@palscans/core/storage'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { fail, ok, parseJson, requireUser } from '@/lib/auth'
import { AVATAR_MAX_BYTES, AVATAR_TYPES, storeAvatar } from '@/lib/auth/avatar'
import { avatarUrl } from '@/lib/auth/media'
import { avatarConfirmSchema } from '@/lib/auth/schemas'
import { verifyUploadedObject } from '@/lib/storage'

/**
 * POST /api/me/avatar/confirm {key} — after the upload landed, point the profile at it.
 * The uploaded object is never served as-is: it must exist under the caller's prefix, be
 * ≤ 2 MB with an allowed type whose magic bytes agree (HEAD + 16-byte range), and is then
 * fetched and re-encoded exactly like the fs upload path (`storeAvatar`) into a
 * content-addressed `avatars/<uid>/<sha12>.webp`; the original is deleted.
 */
export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, avatarConfirmSchema)
  if (!parsed.ok) return parsed.response
  const { key } = parsed.data
  if (!key.startsWith(`avatars/${user.id}/`))
    return fail(403, 'forbidden', messages.errors.forbidden)
  const storage = await getStorage()
  const check = await verifyUploadedObject(storage, key, {
    maxBytes: AVATAR_MAX_BYTES,
    types: AVATAR_TYPES,
  })
  if (!check.ok)
    return check.code === 'missing'
      ? fail(404, 'not_found', messages.errors.notFound)
      : fail(check.code === 'too_large' ? 413 : 415, check.code)
  const body = await storage.get(key)
  if (!body) return fail(404, 'not_found', messages.errors.notFound)
  if (body.byteLength > AVATAR_MAX_BYTES) return fail(413, 'too_large')
  const stored = await storeAvatar(storage, user.id, body)
  if (!stored) return fail(415, 'unsupported_type')
  if (stored !== key) await storage.delete(key).catch(() => undefined)

  const db = await getDb()
  const [prev] = await db
    .select({ avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)
  await db
    .update(users)
    .set({ avatarKey: stored, updatedAt: new Date() })
    .where(eq(users.id, user.id))
  if (prev?.avatarKey && prev.avatarKey !== stored && prev.avatarKey !== key)
    await storage.delete(prev.avatarKey).catch(() => undefined)
  return ok({ key: stored, url: avatarUrl(stored), message: messages.me.settings.avatarUploaded })
})
