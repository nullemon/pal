import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SignedPutUrl, Storage } from '@palscans/core/storage'
import { getStorage } from '@palscans/core/storage'
import '../config/install'
import { configMirror } from '@/lib/config/mirror'
import { getEnv } from '../env'

export const UPLOAD_TTL_MS = 900_000
/**
 * How long a locked page's URL stays valid (docs/03 "Paid content").
 *
 * Sized to a reading session, not to a page render. Every page of a locked chapter is signed
 * once when the page is built, but the reader lazy-loads them as they scroll — so at ten
 * minutes a Premium reader working through a 60-page chapter, or simply pausing, started
 * getting 403s on the rest of it, and the Retry button re-requested the same expired URL.
 * Two hours covers a real read with room to stop and come back; the URL still expires, so a
 * copied link is not a permanent leak.
 */
export const SIGNED_URL_TTL_SEC = 7200

const hmac = (input: string, secret: string = getEnv().SESSION_SECRET): string =>
  createHmac('sha256', secret).update(input).digest('hex')

const sameHex = (given: string, expected: string): boolean => {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The fs "presigned" PUT is an HMAC over key, content type, uploader, expiry and the exact
 * byte size the intent declared — the same binding the S3 signature carries in ContentLength.
 */
export const uploadSignature = (
  key: string,
  contentType: string,
  userId: number,
  exp: number,
  bytes: number,
): string => hmac(`put|${key}|${contentType}|${userId}|${exp}|${bytes}`)

export const verifyUploadSignature = (
  sig: string,
  key: string,
  contentType: string,
  userId: number,
  exp: number,
  bytes: number,
  now: number = Date.now(),
): boolean => {
  if (!Number.isFinite(exp) || exp < now) return false
  return sameHex(sig, uploadSignature(key, contentType, userId, exp, bytes))
}

/**
 * Presigned PUT for the browser (docs/03 upload flow step 4). The S3 driver signs a real
 * URL with the content length bound; the local fs driver points at
 * `/api/upload/put?key=…&exp=…&bytes=…&sig=…`, a route handler that verifies the signature
 * (key, type, uploader, expiry, size) and writes to STORAGE_FS_ROOT after sniffing magic
 * bytes — so only keys minted by an intent, for that user, at that size, are written.
 */
export const presignUpload = async (
  key: string,
  contentType: string,
  userId: number,
  bytes: number,
): Promise<SignedPutUrl> => {
  const storage = await getStorage()
  if (storage.driver === 'fs') {
    const exp = Date.now() + UPLOAD_TTL_MS
    const sig = uploadSignature(key, contentType, userId, exp, bytes)
    const q = new URLSearchParams({ key, exp: String(exp), bytes: String(bytes), sig })
    return {
      url: `/api/upload/put?${q.toString()}`,
      method: 'PUT',
      headers: { 'content-type': contentType },
      expiresAt: new Date(exp),
    }
  }
  return storage.getSignedPutUrl(key, {
    contentType,
    contentLength: bytes,
    expiresInSeconds: UPLOAD_TTL_MS / 1000,
  })
}

export type UploadedObjectCheck =
  | { ok: true; bytes: number; type: string }
  | { ok: false; code: 'missing' | 'too_large' | 'unsupported_type' }

/**
 * What a confirm step must establish about an object the browser uploaded directly to the
 * store (docs/03 step 4 applies to the bytes, not just the manifest): it exists, its size
 * is within the cap, its stored type is allowed, and the first bytes really are that image
 * type. Only HEAD and a 16-byte range are read — never the body.
 */
export const verifyUploadedObject = async (
  storage: Storage,
  key: string,
  opts: { maxBytes: number; types: ReadonlySet<string> },
): Promise<UploadedObjectCheck> => {
  const info = await storage.head(key)
  if (!info) return { ok: false, code: 'missing' }
  if (info.size <= 0 || info.size > opts.maxBytes) return { ok: false, code: 'too_large' }
  if (!info.contentType || !opts.types.has(info.contentType))
    return { ok: false, code: 'unsupported_type' }
  const head = await storage.getRange(key, 0, 15)
  if (!head) return { ok: false, code: 'missing' }
  const sniffed = sniffImage(head)
  if (!sniffed || sniffed !== info.contentType) return { ok: false, code: 'unsupported_type' }
  return { ok: true, bytes: info.size, type: info.contentType }
}

/** The fs driver's signed GET: an HMAC over the key and its expiry, checked by /api/storage. */
export const storageGetSignature = (key: string, exp: number): string => hmac(`get|${key}|${exp}`)

export const verifyStorageGetSignature = (
  sig: string,
  key: string,
  exp: number,
  now: number = Date.now(),
): boolean => {
  if (!Number.isFinite(exp) || exp < now) return false
  return sameHex(sig, storageGetSignature(key, exp))
}

/**
 * A URL for an object that must not be public (docs/03 "Paid content"): the S3 driver's
 * presigned GET, or the fs driver's `/_storage/<key>?exp=…&sig=…`. Both expire after
 * `SIGNED_URL_TTL_SEC`, so a copied URL stops working instead of becoming a permanent leak.
 */
export const signedStorageUrl = async (
  key: string,
  ttlSec: number = SIGNED_URL_TTL_SEC,
): Promise<string> => {
  const storage = await getStorage()
  if (storage.driver !== 'fs') return storage.getSignedGetUrl(key, ttlSec)
  const exp = Date.now() + ttlSec * 1000
  const q = new URLSearchParams({ exp: String(exp), sig: storageGetSignature(key, exp) })
  return `${storageUrl(key)}?${q.toString()}`
}

/** Public URL for a key: path-only on the fs driver, CDN otherwise. */
export const storageUrl = (key: string): string => {
  const safe = key.split('/').map(encodeURIComponent).join('/')
  const { driver, cdnUrl } = configMirror()
  if (driver === 'fs') return `/_storage/${safe}`
  return `${cdnUrl.replace(/\/+$/, '')}/${safe}`
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
