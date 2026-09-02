import { createHash } from 'node:crypto'
import { MAX_ORIGINAL_BYTES, type Storage } from '@palscans/core/storage'
import { type Db, type SeriesArtPending, series } from '@palscans/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { log } from '../lib/log.js'
import { revalidateWeb } from '../lib/revalidate.js'

export type ArtKind = 'cover' | 'banner'

/** docs/03 storage layout: covers 200/400/800, banners 800/1600/2400 — AVIF + WebP. */
export const ART_WIDTHS: Record<ArtKind, readonly number[]> = {
  cover: [200, 400, 800],
  banner: [800, 1600, 2400],
}
export const ART_FOLDER: Record<ArtKind, 'covers' | 'banners'> = {
  cover: 'covers',
  banner: 'banners',
}
/** Covers and banners are photos, not 5 000 px strips: 40 MP is already generous. */
const MAX_PIXELS = 40_000_000
const MAX_INPUT_BYTES = Math.min(MAX_ORIGINAL_BYTES, 20 * 1024 * 1024)

export interface ArtVariant {
  w: number
  fmt: 'avif' | 'webp'
  key: string
  data: Buffer
}

export interface EncodedArt {
  /** Content address: sha256 of the oriented, metadata-free source. */
  sha: string
  width: number
  height: number
  variants: ArtVariant[]
  /** The key the `cover_key` / `banner_key` column points at (largest WebP). */
  primaryKey: string
}

/** The variant key: `covers/<slug>/<sha12>.<w>.<fmt>`. */
export const artKey = (kind: ArtKind, slug: string, sha: string, w: number, fmt: 'avif' | 'webp') =>
  `${ART_FOLDER[kind]}/${slug}/${sha}.${w}.${fmt}`

/**
 * Re-encode an uploaded cover / banner original: EXIF orientation applied, every byte of
 * metadata dropped (sharp writes none unless asked), downscale-only to the docs/03 widths,
 * AVIF + WebP under content-addressed keys. Throws on anything sharp cannot decode.
 */
export const encodeArt = async (
  source: Uint8Array,
  kind: ArtKind,
  slug: string,
  opts: { avifEffort?: number } = {},
): Promise<EncodedArt> => {
  const oriented = await sharp(source, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
    .rotate()
    .png({ compressionLevel: 1 })
    .toBuffer({ resolveWithObject: true })
  const { width, height } = oriented.info
  if (!width || !height) throw new Error('decode failed')
  const sha = createHash('sha256').update(oriented.data).digest('hex').slice(0, 12)
  const widths = ART_WIDTHS[kind].filter((w) => w <= width)
  if (widths.length === 0) widths.push(width)
  const variants: ArtVariant[] = []
  for (const w of widths) {
    const resized = sharp(oriented.data).resize({ width: w, withoutEnlargement: true })
    variants.push({
      w,
      fmt: 'webp',
      key: artKey(kind, slug, sha, w, 'webp'),
      data: await resized.clone().webp({ quality: 82 }).toBuffer(),
    })
    variants.push({
      w,
      fmt: 'avif',
      key: artKey(kind, slug, sha, w, 'avif'),
      data: await resized
        .clone()
        .avif({ quality: 60, effort: opts.avifEffort ?? 4 })
        .toBuffer(),
    })
  }
  const largest = widths[widths.length - 1] as number
  return { sha, width, height, variants, primaryKey: artKey(kind, slug, sha, largest, 'webp') }
}

export interface ArtDeps {
  db: Db
  storage: Storage
  now?: () => Date
}

/**
 * `series.art`: the pending original recorded by the admin art PATCH is verified (HEAD size
 * before any GET), re-encoded, written under `covers/` or `banners/`, and only then does the
 * series point at it. The original is deleted afterwards; a failure is kept on the pending
 * entry so the admin screen can show it, and the previous public key stays untouched.
 */
export const processSeriesArt = async (
  seriesId: number,
  kind: ArtKind,
  deps: ArtDeps,
): Promise<'done' | 'failed' | 'skipped'> => {
  const { db, storage } = deps
  const now = deps.now ?? (() => new Date())
  const [row] = await db
    .select({ id: series.id, slug: series.slug, artPending: series.artPending })
    .from(series)
    .where(eq(series.id, seriesId))
    .limit(1)
  const entry = row?.artPending?.[kind]
  if (!row || !entry) {
    log.warn('series.art skipped', { seriesId, kind })
    return 'skipped'
  }
  const fail = async (message: string) => {
    const pending: SeriesArtPending = { ...row.artPending, [kind]: { ...entry, error: message } }
    await db
      .update(series)
      .set({ artPending: pending, updatedAt: now() })
      .where(eq(series.id, seriesId))
    log.warn('series.art failed', { seriesId, kind, error: message })
    return 'failed' as const
  }
  try {
    const info = await storage.head(entry.key)
    if (!info) return await fail(`missing object ${entry.key}`)
    if (info.size > MAX_INPUT_BYTES) return await fail(`original too large: ${info.size} bytes`)
    const original = await storage.get(entry.key)
    if (!original) return await fail(`missing object ${entry.key}`)
    const encoded = await encodeArt(original, kind, row.slug)
    for (const v of encoded.variants) {
      await storage.put(v.key, new Uint8Array(v.data), {
        contentType: v.fmt === 'avif' ? 'image/avif' : 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      })
    }
    const rest: SeriesArtPending = { ...row.artPending }
    delete rest[kind]
    await db
      .update(series)
      .set({
        [kind === 'cover' ? 'coverKey' : 'bannerKey']: encoded.primaryKey,
        artPending: Object.keys(rest).length ? rest : null,
        updatedAt: now(),
      })
      .where(eq(series.id, seriesId))
    await storage.delete(entry.key).catch(() => undefined)
    log.info('series.art done', { seriesId, kind, key: encoded.primaryKey })
    await revalidateWeb(['catalog'])
    return 'done'
  } catch (err) {
    return fail((err instanceof Error ? err.message : String(err)).slice(0, 300))
  }
}
