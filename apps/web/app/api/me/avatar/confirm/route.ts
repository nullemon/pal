import { messages } from '@palscans/core/messages'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { fail, getRateLimiter, ok, parseJson, rateLimited, requireUser } from '@/lib/auth'
import { AVATAR_MAX_BYTES, AVATAR_TYPES, storeAvatar } from '@/lib/auth/avatar'
import { avatarUrl } from '@/lib/auth/media'
import { avatarConfirmSchema } from '@/lib/auth/schemas'
import { getStorage, verifyUploadedObject } from '@/lib/storage'

/**
 * POST /api/me/avatar/confirm {key} — after the upload landed, point the profile at it.
 * The uploaded object is never served as-is: it must exist under the caller's prefix, be
 * ≤ 2 MB with an allowed type whose magic bytes agree (HEAD + 16-byte range), and is then
 * fetched and re-encoded exactly like the fs upload path (`storeAvatar`) into a
 * content-addressed `avatars/<uid>/<sha12>.webp`. Every other object under the user's
 * prefix (the original, the previous avatar, uploads that were never confirmed) is then
 * deleted. Upload + confirm share one per-user limit (10/hour).
 */
export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, avatarConfirmSchema)
  if (!parsed.ok) return parsed.response
  const { key } = parsed.data
  if (!key.startsWith(`avatars/${user.id}/`))
    return fail(403, 'forbidden', messages.errors.forbidden)
  const limit = await getRateLimiter().hit(`avatar:${user.id}`, 10, 3600)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)
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
  if (!stored) {
    // not decodable after all: the raw upload must not linger under the prefix
    await storage.delete(key).catch(() => undefined)
    return fail(415, 'unsupported_type')
  }

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
  // One avatar per user: sweep everything else under the prefix — the raw upload, the
  // previous avatar and any earlier upload that was never confirmed — so nothing is orphaned.
  const listed = await storage.list(`avatars/${user.id}/`).catch((): string[] => [])
  const stale = [...new Set([...listed, key, prev?.avatarKey])].filter(
    (k): k is string => !!k && k !== stored,
  )
  await Promise.all(stale.map((k) => storage.delete(k).catch(() => undefined)))
  return ok({ key: stored, url: avatarUrl(stored), message: messages.me.settings.avatarUploaded })
})
