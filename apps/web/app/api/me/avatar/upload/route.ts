import { getStorage } from '@palscans/core/storage'
import { z } from 'zod'
import {
  fail,
  getRateLimiter,
  ok,
  parseQuery,
  rateLimited,
  readBody,
  requireUser,
} from '@/lib/auth'
import { AVATAR_MAX_BYTES, AVATAR_TYPES, storeAvatar } from '@/lib/auth/avatar'
import { sniffImage } from '@/lib/storage'

const querySchema = z.object({
  key: z.string().regex(/^avatars\/\d+\/[a-f0-9]{16}\.(png|jpg|webp)$/),
})

/**
 * PUT /api/me/avatar/upload?key=… — the fs-driver stand-in for a presigned PUT (own key
 * only). The body is capped at 2 MB through Content-Length and a streaming reader, so a
 * multi-gigabyte PUT is cut off instead of buffered. The bytes are never stored as
 * uploaded: `storeAvatar` decodes and re-encodes them (orientation applied, EXIF dropped,
 * 256×256 cover crop, WebP) under a content-addressed key returned as `data.key`; the
 * client confirms that one. Upload + confirm share one per-user limit (10/hour).
 */
export const PUT = requireUser(async (request, _ctx, user) => {
  const query = parseQuery(request, querySchema)
  if (!query.ok) return query.response
  if (!query.data.key.startsWith(`avatars/${user.id}/`)) return fail(403, 'forbidden')
  const type = request.headers.get('content-type') ?? ''
  if (!AVATAR_TYPES.has(type)) return fail(415, 'unsupported_type')
  const limit = await getRateLimiter().hit(`avatar:${user.id}`, 10, 3600)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)
  const read = await readBody(request, AVATAR_MAX_BYTES, { requireLength: true })
  if (!read.ok) return read.response
  const body = read.body
  if (body.byteLength === 0) return fail(413, 'too_large')
  if (sniffImage(body) !== type) return fail(415, 'unsupported_type')
  const key = await storeAvatar(await getStorage(), user.id, body)
  if (!key) return fail(415, 'unsupported_type')
  return ok({ key })
})
