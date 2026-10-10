/**
 * Image bytes, independent of where they came from.
 *
 * `sniffImage` lived in `apps/web/lib/storage` until the gallery import needed it. The
 * browser-upload path can lean on the presigned PUT's declared type; the import path cannot,
 * because it downloads from a third-party host and "the server said image/jpeg" is not a
 * reason to believe it. Both paths now sniff with the same function, so they cannot drift
 * into disagreeing about what counts as an image.
 */

/** The source types the pipeline accepts. Anything else is refused before the worker sees it. */
export const IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
] as const

export type ImageType = (typeof IMAGE_TYPES)[number]

export const IMAGE_EXTENSIONS: Record<ImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

export const isImageType = (value: unknown): value is ImageType =>
  typeof value === 'string' && (IMAGE_TYPES as readonly string[]).includes(value)

/**
 * Magic-byte sniff (docs/03 step 4): what the bytes actually are, not what anyone claimed.
 *
 * Returns null for anything unrecognised, which every caller treats as a refusal — a
 * deliberately short allowlist rather than a "probably fine" default, because the value
 * flows into `sharp` and into the object store's content type.
 */
export const sniffImage = (b: Uint8Array): ImageType | null => {
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
