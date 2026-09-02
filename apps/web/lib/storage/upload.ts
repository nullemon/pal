import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SignedPutUrl } from '@palscans/core/storage'
import { getStorage } from '@palscans/core/storage'
import { getEnv } from '../env'

export const UPLOAD_TTL_MS = 900_000

/** The fs "presigned" PUT is an HMAC over key, content type, uploader and expiry. */
export const uploadSignature = (
  key: string,
  contentType: string,
  userId: number,
  exp: number,
): string =>
  createHmac('sha256', getEnv().SESSION_SECRET)
    .update(`${key}|${contentType}|${userId}|${exp}`)
    .digest('hex')

export const verifyUploadSignature = (
  sig: string,
  key: string,
  contentType: string,
  userId: number,
  exp: number,
  now: number = Date.now(),
): boolean => {
  if (!Number.isFinite(exp) || exp < now) return false
  const expected = Buffer.from(uploadSignature(key, contentType, userId, exp))
  const given = Buffer.from(sig)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Presigned PUT for the browser (docs/03 upload flow step 4). The S3 driver signs a real
 * URL; the local fs driver points at `/api/upload/put?key=…&exp=…&sig=…`, a route handler
 * that verifies the signature (key, type, uploader, expiry) and writes to STORAGE_FS_ROOT
 * after sniffing magic bytes — so only keys minted by an intent, for that user, are written.
 */
export const presignUpload = async (
  key: string,
  contentType: string,
  userId: number,
): Promise<SignedPutUrl> => {
  const storage = await getStorage()
  if (storage.driver === 'fs') {
    const exp = Date.now() + UPLOAD_TTL_MS
    const sig = uploadSignature(key, contentType, userId, exp)
    const q = new URLSearchParams({ key, exp: String(exp), sig })
    return {
      url: `/api/upload/put?${q.toString()}`,
      method: 'PUT',
      headers: { 'content-type': contentType },
      expiresAt: new Date(exp),
    }
  }
  return storage.getSignedPutUrl(key, { contentType, expiresInSeconds: UPLOAD_TTL_MS / 1000 })
}

/** Public URL for a key: path-only on the fs driver, CDN otherwise. */
export const storageUrl = (key: string): string => {
  const safe = key.split('/').map(encodeURIComponent).join('/')
  const env = getEnv()
  if (env.STORAGE_DRIVER === 'fs') return `/_storage/${safe}`
  return `${env.PUBLIC_CDN_URL.replace(/\/+$/, '')}/${safe}`
}

/** Magic-byte sniff (docs/03 step 4): the declared type must match the bytes. */
export const sniffImage = (b: Uint8Array): string | null => {
  if (b.length < 12) return null
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45
  )
    return 'image/webp'
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0)
    if (brand.startsWith('avi')) return 'image/avif'
  }
  return null
}
