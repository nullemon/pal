import { createHash } from 'node:crypto'
import { getStorage } from '@palscans/core/storage'
import sharp from 'sharp'
import { z } from 'zod'
import { fail, ok, parseQuery, requireUser } from '@/lib/auth'

const MAX = 2 * 1024 * 1024
/** Decoded-pixel cap for the re-encode (a 4000×4000 photo passes; a decompression bomb does not). */
const MAX_INPUT_PIXELS = 16_000_000
const AVATAR_SIZE = 256
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const querySchema = z.object({
  key: z.string().regex(/^avatars\/\d+\/[a-f0-9]{16}\.(png|jpg|webp)$/),
})

const MAGIC: Array<{ type: string; test: (b: Uint8Array) => boolean }> = [
  {
    type: 'image/png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/webp',
    test: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45,
  },
]

/**
 * PUT /api/me/avatar/upload?key=… — the fs-driver stand-in for a presigned PUT (own key
 * only). The bytes are never stored as uploaded: they are decoded and re-encoded with sharp
 * (orientation applied, EXIF dropped, 256×256 cover crop, WebP), so metadata and polyglot
 * payloads do not reach the public `/_storage/avatars/…` path. The stored key is
 * content-addressed and returned as `data.key`; the client confirms that one.
 */
export const PUT = requireUser(async (request, _ctx, user) => {
  const query = parseQuery(request, querySchema)
  if (!query.ok) return query.response
  if (!query.data.key.startsWith(`avatars/${user.id}/`)) return fail(403, 'forbidden')
  const type = request.headers.get('content-type') ?? ''
  if (!TYPES.has(type)) return fail(415, 'unsupported_type')
  const body = new Uint8Array(await request.arrayBuffer())
  if (body.byteLength === 0 || body.byteLength > MAX) return fail(413, 'too_large')
  if (!MAGIC.some((m) => m.type === type && m.test(body))) return fail(415, 'unsupported_type')

  let out: Buffer
  try {
    out = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .webp({ quality: 82 })
      .toBuffer()
  } catch {
    return fail(415, 'unsupported_type')
  }
  const sha12 = createHash('sha256').update(out).digest('hex').slice(0, 12)
  const key = `avatars/${user.id}/${sha12}.webp`
  const storage = await getStorage()
  await storage.put(key, new Uint8Array(out), {
    contentType: 'image/webp',
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return ok({ key })
})
