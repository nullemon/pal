import { createHash } from 'node:crypto'
import {
  type WatermarkConfig,
  watermarkFingerprint,
  watermarkGeometry,
  watermarkSvg,
} from '@palscans/core/watermark'
import { encode } from 'blurhash'
import sharp, { type OverlayOptions, type Sharp } from 'sharp'

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
  /** Content address: sha256 of the oriented, stripped segment plus the watermark applied. */
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
  /**
   * Burn the operator's watermark into every variant (docs/03, Admin → Appearance →
   * Watermark). Composited *after* the resize, so each width carries a crisp mark of the
   * same relative size rather than a downscaled copy of the largest one. Omitted or
   * disabled leaves the pixels — and the content address — exactly as before.
   */
  watermark?: WatermarkConfig | null
}

export const contentHash = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex').slice(0, 12)

/**
 * The content address of one emitted page: the segment's bytes *plus* the watermark that
 * will be burned into it.
 *
 * Page objects are served `immutable` forever, so two different marks must never land on
 * one key. Folding the fingerprint in means changing the watermark re-processes to fresh
 * keys and the old objects simply stop being referenced — the same behaviour docs/03
 * describes for a re-uploaded page, and the reason no CDN purge is needed. With the mark
 * off the fingerprint is empty and the address is the plain hash it always was.
 */
export const pageAddress = (segment: Uint8Array, watermark?: WatermarkConfig | null): string => {
  const fingerprint = watermark ? watermarkFingerprint(watermark) : ''
  const hash = createHash('sha256').update(segment)
  if (fingerprint) hash.update(`\u0000${fingerprint}`)
  return hash.digest('hex').slice(0, 12)
}

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

/**
 * The overlay for one already-resized variant, or `null` when the mark does not fit.
 *
 * The overlay is a full-width band pinned with a gravity rather than a page-sized layer at
 * an absolute offset: libvips decides the exact height of a resize, and a one-pixel
 * disagreement between our arithmetic and its own would make the composite throw. A band
 * plus `north`/`south` cannot disagree.
 */
export const watermarkOverlay = (
  width: number,
  height: number,
  config: WatermarkConfig,
): OverlayOptions | null => {
  const geometry = watermarkGeometry(width, height, config)
  if (!geometry) return null
  return { input: Buffer.from(watermarkSvg(geometry)), gravity: geometry.gravity }
}

let fontProbe: Promise<boolean> | undefined

/** Test seam: forget the cached probe. */
export const resetWatermarkFontProbe = (): void => {
  fontProbe = undefined
}

/**
 * Does this host have a font librsvg can draw the mark with?
 *
 * `node:22-alpine` ships none, and a missing face is silent — librsvg renders an empty
 * layer and the pipeline would burn an invisible watermark into every page and every
 * content address. So probe once per process and let the caller refuse rather than lie.
 * `infra/Dockerfile` installs `font-dejavu` in the worker image for this reason.
 */
export const watermarkFontAvailable = async (): Promise<boolean> => {
  fontProbe ??= (async () => {
    try {
      const svg = watermarkSvg({
        width: 256,
        height: 64,
        fontSize: 32,
        margin: 8,
        x: 8,
        y: 40,
        anchor: 'start',
        gravity: 'north',
        strokeWidth: 5,
        opacity: 1,
        text: 'palscans.org',
      })
      const { data, info } = await sharp(Buffer.from(svg))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      for (let i = 3; i < data.length; i += info.channels) if (data[i] !== 0) return true
      return false
    } catch {
      return false
    }
  })()
  return fontProbe
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

/** One emitted page before any resize or encode: the pixels the content address is taken of. */
export interface SourceSegment {
  /** Offset from `startIdx`. */
  offset: number
  width: number
  height: number
  /** The oriented, stripped, cropped segment as PNG — the exact bytes `pageAddress` hashes. */
  png: Buffer
}

/**
 * Decode one uploaded original into the segments the pipeline would emit for it.
 *
 * Split out of {@link processImage} so a caller can ask *what address would this page have*
 * without paying for eight encodes. `watermark.reapply` uses it to prove a chapter already
 * carries the mark it is about to apply, and to leave it completely alone when it does —
 * which is roughly a tenth of the cost of finding out by re-encoding.
 */
export const decodeSegments = async (source: Uint8Array): Promise<SourceSegment[]> => {
  const oriented = await sharp(source, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
    .rotate()
    .png({ compressionLevel: 1 })
    .toBuffer({ resolveWithObject: true })
  const { width, height } = oriented.info
  if (!width || !height) throw new Error('decode failed')
  if (width > MAX_SIDE || height > MAX_SIDE) throw new Error(`image too large: ${width}×${height}`)
  if (width * height > MAX_PIXELS) throw new Error(`image too large: ${width}×${height}`)

  const out: SourceSegment[] = []
  for (const [i, seg] of segmentsFor(height).entries()) {
    const png = await sharp(oriented.data)
      .extract({ left: 0, top: seg.top, width, height: seg.height })
      .png({ compressionLevel: 1 })
      .toBuffer()
    out.push({ offset: i, width, height: seg.height, png })
  }
  return out
}

/** What one original would be addressed as under a given mark, without encoding anything. */
export interface PlannedPage {
  /** Offset from the caller's `startIdx`, matching {@link ProcessOptions.startIdx}. */
  offset: number
  sha: string
  width: number
  height: number
}

/**
 * The content addresses one original would produce under `watermark` — nothing else.
 *
 * The whole point of this shortcut is that it reads only the *original*: it can say what a
 * chapter's pages should be called without ever touching a page object, which is what keeps
 * a re-apply from feeding an already-marked image back through the compositor.
 */
export const plannedAddresses = async (
  source: Uint8Array,
  watermark?: WatermarkConfig | null,
): Promise<PlannedPage[]> => {
  const mark = watermark?.enabled ? watermark : null
  return (await decodeSegments(source)).map((s) => ({
    offset: s.offset,
    sha: pageAddress(s.png, mark),
    width: s.width,
    height: s.height,
  }))
}

/** Process one uploaded original into one or more encoded pages. Throws on decode failure. */
export const processImage = async (
  source: Uint8Array,
  opts: ProcessOptions,
): Promise<EncodedPage[]> => {
  const pages: EncodedPage[] = []
  const segments = await decodeSegments(source)
  for (const seg of segments) {
    const idx = opts.startIdx + seg.offset
    const width = seg.width
    const segPng = seg.png
    const mark = opts.watermark?.enabled ? opts.watermark : null
    const sha = pageAddress(segPng, mark)
    const variants: EncodedVariant[] = []
    for (const w of widthsFor(width)) {
      // Only downscale, so the emitted height follows the width exactly; the band is
      // gravity-pinned, which is what makes the estimate safe.
      const outHeight = Math.max(1, Math.round((seg.height * w) / width))
      const overlay = mark ? watermarkOverlay(w, outHeight, mark) : null
      const scaled = sharp(segPng).resize({ width: w, withoutEnlargement: true })
      const resized = overlay ? scaled.composite([overlay]) : scaled
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
