import { createHash } from 'node:crypto'
import { encode } from 'blurhash'
import sharp, { type Sharp } from 'sharp'

/**
 * docs/03 "Worker: chapter.process", per page: apply EXIF orientation and strip metadata,
 * read intrinsic dimensions, reject the absurd, downscale-only to 480/720/1080/1440, encode
 * AVIF q55 (effort 4) + WebP q78, 4×3 BlurHash, content-addressed keys. Long strips taller
 * than 10 000 px are sliced into ≤ 5 000 px segments emitted as consecutive pages.
 */
export const WIDTHS = [480, 720, 1080, 1440] as const
export const MAX_SIDE = 12_000
export const MAX_PIXELS = 40_000_000
export const SPLIT_ABOVE = 10_000
export const SEGMENT_HEIGHT = 5_000

sharp.concurrency(Math.max(1, Math.min(2, sharp.concurrency())))

export interface EncodedVariant {
  w: number
  fmt: 'avif' | 'webp'
  bytes: number
  key: string
  data: Buffer
}

export interface EncodedPage {
  /** sha256 of the oriented, stripped source segment — the content address. */
  sha: string
  width: number
  height: number
  blurHash: string | null
  variants: EncodedVariant[]
}

export interface ProcessOptions {
  /** `pages/<seriesId>/<chapterId>` */
  prefix: string
  /** Display index of the first emitted page (segments continue from it). */
  startIdx: number
  avifQuality?: number
  webpQuality?: number
  avifEffort?: number
}

export const contentHash = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex').slice(0, 12)

/** The variant object key: `pages/1284/59310/0007-9f2c1ab4de07.720.avif`. */
export const variantKey = (
  prefix: string,
  idx: number,
  sha: string,
  w: number,
  fmt: 'avif' | 'webp',
) => `${prefix}/${String(idx).padStart(4, '0')}-${sha}.${w}.${fmt}`

/** Widths to emit for a source width: only downscale, never upscale. */
export const widthsFor = (sourceWidth: number): number[] => {
  const out = WIDTHS.filter((w) => w <= sourceWidth)
  return out.length ? out : [sourceWidth]
}

/** Split a tall image into ≤ SEGMENT_HEIGHT slices (0 px overlap, docs/03). */
export const segmentsFor = (height: number): Array<{ top: number; height: number }> => {
  if (height <= SPLIT_ABOVE) return [{ top: 0, height }]
  const count = Math.ceil(height / SEGMENT_HEIGHT)
  const base = Math.floor(height / count)
  const segments: Array<{ top: number; height: number }> = []
  let top = 0
  for (let i = 0; i < count; i++) {
    const h = i === count - 1 ? height - top : base
    segments.push({ top, height: h })
    top += h
  }
  return segments
}

export const blurHashFor = async (image: Sharp): Promise<string | null> => {
  try {
    const { data, info } = await image
      .clone()
      .resize(32, 32, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return encode(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      info.width,
      info.height,
      4,
      3,
    )
  } catch {
    return null
  }
}

/** Process one uploaded original into one or more encoded pages. Throws on decode failure. */
export const processImage = async (
  source: Uint8Array,
  opts: ProcessOptions,
): Promise<EncodedPage[]> => {
  const oriented = await sharp(source, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
    .rotate()
    .png({ compressionLevel: 1 })
    .toBuffer({ resolveWithObject: true })
  const { width, height } = oriented.info
  if (!width || !height) throw new Error('decode failed')
  if (width > MAX_SIDE || height > MAX_SIDE) throw new Error(`image too large: ${width}×${height}`)
  if (width * height > MAX_PIXELS) throw new Error(`image too large: ${width}×${height}`)

  const pages: EncodedPage[] = []
  const segments = segmentsFor(height)
  for (const [i, seg] of segments.entries()) {
    const idx = opts.startIdx + i
    const base = sharp(oriented.data).extract({ left: 0, top: seg.top, width, height: seg.height })
    const segPng = await base.clone().png({ compressionLevel: 1 }).toBuffer()
    const sha = contentHash(segPng)
    const variants: EncodedVariant[] = []
    for (const w of widthsFor(width)) {
      const resized = sharp(segPng).resize({ width: w, withoutEnlargement: true })
      const webp = await resized
        .clone()
        .webp({ quality: opts.webpQuality ?? 78 })
        .toBuffer()
      variants.push({
        w,
        fmt: 'webp',
        bytes: webp.byteLength,
        key: variantKey(opts.prefix, idx, sha, w, 'webp'),
        data: webp,
      })
      const avif = await resized
        .clone()
        .avif({ quality: opts.avifQuality ?? 55, effort: opts.avifEffort ?? 4 })
        .toBuffer()
      variants.push({
        w,
        fmt: 'avif',
        bytes: avif.byteLength,
        key: variantKey(opts.prefix, idx, sha, w, 'avif'),
        data: avif,
      })
    }
    pages.push({
      sha,
      width,
      height: seg.height,
      blurHash: await blurHashFor(sharp(segPng)),
      variants,
    })
  }
  return pages
}
