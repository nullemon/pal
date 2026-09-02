import { randomBytes } from 'node:crypto'
import { getStorage } from '@palscans/core/storage'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { ok, parseJson, requireUser } from '@/lib/auth'
import { avatarPresignSchema } from '@/lib/auth/schemas'

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * POST /api/me/avatar {contentType, size} → a presigned PUT (S3/R2) or, with the local fs
 * driver, this app's own PUT /api/me/avatar/upload?key=… so uploads work without the worker.
 * DELETE /api/me/avatar — remove the avatar.
 */
export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, avatarPresignSchema)
  if (!parsed.ok) return parsed.response
  const key = `avatars/${user.id}/${randomBytes(8).toString('hex')}.${EXT[parsed.data.contentType]}`
  const storage = await getStorage()
  if (storage.driver === 'fs') {
    return ok({
      key,
      url: `/api/me/avatar/upload?key=${encodeURIComponent(key)}`,
      method: 'PUT',
      headers: { 'content-type': parsed.data.contentType },
    })
  }
  const signed = await storage.getSignedPutUrl(key, {
    contentType: parsed.data.contentType,
    expiresInSeconds: 600,
  })
  return ok({ key, url: signed.url, method: signed.method, headers: signed.headers })
})

export const DELETE = requireUser(async (_request, _ctx, user) => {
  const db = await getDb()
  const [row] = await db
    .select({ avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)
  await db
    .update(users)
    .set({ avatarKey: null, updatedAt: new Date() })
    .where(eq(users.id, user.id))
  if (row?.avatarKey) {
    const storage = await getStorage()
    await storage.delete(row.avatarKey).catch(() => undefined)
  }
  return ok({ removed: true })
})
