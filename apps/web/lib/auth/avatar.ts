import { createHash } from 'node:crypto'
import type { Storage } from '@palscans/core/storage'
import sharp from 'sharp'

/**
 * Avatar policy, shared by the fs upload route and the S3/R2 confirm step so both paths
 * store the same thing: never the uploaded bytes. The image is decoded and re-encoded
 * (orientation applied, EXIF/GPS dropped, 256×256 cover crop, WebP) and written under a
 * content-addressed key — metadata and polyglot payloads never reach the public CDN.
 */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp'])
export const AVATAR_SIZE = 256
/** Decoded-pixel cap for the re-encode (a 4000×4000 photo passes; a decompression bomb does not). */
const MAX_INPUT_PIXELS = 16_000_000

/** Decode and re-encode; null when the bytes are not a decodable still image. */
export const reencodeAvatar = async (body: Uint8Array): Promise<Buffer | null> => {
  if (body.byteLength === 0 || body.byteLength > AVATAR_MAX_BYTES) return null
  try {
    return await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .webp({ quality: 82 })
      .toBuffer()
  } catch {
    return null
  }
}

/** `avatars/<uid>/<sha256[:12]>.webp` — the key names the encoded bytes, not the upload. */
export const avatarKeyFor = (userId: number, encoded: Uint8Array): string =>
  `avatars/${userId}/${createHash('sha256').update(encoded).digest('hex').slice(0, 12)}.webp`

/** Re-encode `body` and store it for `userId`; the stored key, or null when not an image. */
export const storeAvatar = async (
  storage: Storage,
  userId: number,
  body: Uint8Array,
): Promise<string | null> => {
  const out = await reencodeAvatar(body)
  if (!out) return null
  const key = avatarKeyFor(userId, out)
  await storage.put(key, new Uint8Array(out), {
    contentType: 'image/webp',
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return key
}
