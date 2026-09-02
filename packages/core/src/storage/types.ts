/**
 * One Storage interface for R2 / MinIO / S3 and a local fs driver (docs/16 decisions).
 * Keys are object keys (`covers/abc.avif`), never URLs; `getUrl` turns a key into the
 * public CDN URL.
 */
export interface PutOptions {
  contentType?: string
  cacheControl?: string
  metadata?: Record<string, string>
}

export interface SignedPutUrl {
  url: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: Date
}

export interface Storage {
  readonly driver: 'fs' | 's3'
  put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void>
  get(key: string): Promise<Uint8Array | null>
  /** A presigned PUT the browser can upload to directly; the fs driver returns a dev route. */
  getSignedPutUrl(
    key: string,
    opts?: PutOptions & { expiresInSeconds?: number },
  ): Promise<SignedPutUrl>
  getUrl(key: string): string
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

export const CONTENT_TYPES: Record<string, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  gz: 'application/gzip',
}

export const contentTypeFor = (key: string): string => {
  const ext = key.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/** Reject keys that could escape a prefix or the fs root. */
export const assertSafeKey = (key: string): string => {
  if (
    !key ||
    key.startsWith('/') ||
    key.includes('\\') ||
    key.includes('\0') ||
    key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`)
  }
  return key
}

export const joinUrl = (base: string, key: string): string =>
  `${base.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
