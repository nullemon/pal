import { getDb, getSetting, settings } from '@palscans/db'
import sharp from 'sharp'
import {
  brandAssetConfirmSchema,
  brandAssetIntentSchema,
  brandAssetSlotSchema,
} from '@/components/admin/schemas-appearance'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'
import { brandSettingSchema } from '@/lib/chrome/schema'
import { getStorage, presignUpload, storageUrl } from '@/lib/storage'

/**
 * The logo / monogram / social-image uploads for Appearance → Brand (docs/15).
 *
 * Same three-step shape as the series artwork route (`/api/admin/series/:id/art`) — intent,
 * direct PUT to storage, confirm — rather than a second uploader: the presign, the fs-driver
 * stand-in and the retrying client-side PUT are all reused as they are.
 *
 * Where it differs from artwork, and why:
 *
 * - **The original is never what gets served.** A confirmed raster is re-encoded by sharp on
 *   the way to its public key, which strips EXIF (including GPS) and normalises orientation.
 *   Artwork gets that from the worker's `chapter.art` job; a logo has no worker step, so it
 *   happens here — the files are small enough that a synchronous encode is nothing.
 * - **SVG is allowed, and checked rather than sanitised.** docs/15 prefers SVG for a logo,
 *   and an SVG is a document that can carry script. Ours are only ever painted through
 *   `<img>`, where script never executes, and the fs storage host serves them under
 *   `default-src 'none'; sandbox`; but a CDN in front of an S3 bucket has no such header, so
 *   an upload containing `<script>`, an `on*` handler, a `javascript:` URL or a
 *   `<foreignObject>` is **refused**. Rejecting is honest where a regex sanitiser would only
 *   look safe.
 * - **The cap is 2 MB.** A site logo that is bigger than that is a mistake, and the whole
 *   object is read into memory here to validate it.
 */

export const MAX_BRAND_BYTES = 2 * 1024 * 1024

const ext: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

/** Markup that must not appear in an SVG we will host. Checked on the decoded text. */
const SVG_FORBIDDEN = /<script|<foreignObject|\son[a-z]+\s*=|javascript:/i

/** POST — presign the upload. The original lands under `uploads/brand/`, never `brand/`. */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, brandAssetIntentSchema)
  if (!parsed.ok) return parsed.response
  const { slot, sha256, type, bytes } = parsed.data
  const key = `uploads/brand/${slot}-${sha256.slice(0, 12)}.${ext[type]}`
  const signed = await presignUpload(key, type, user.id, bytes)
  return ok({ key, url: signed.url, method: signed.method, headers: signed.headers })
})

/**
 * PATCH — confirm an uploaded original: read it, prove it is the image type it claims, record
 * its intrinsic size, write the sanitised copy to its public key and point the setting at it.
 */
export const PATCH = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, brandAssetConfirmSchema)
  if (!parsed.ok) return parsed.response
  const { slot, key } = parsed.data
  if (!key.startsWith(`uploads/brand/${slot}-`)) return fail(400, 'validation')

  const storage = await getStorage()
  /**
   * A refused upload is deleted before the error is returned. The `uploads/` prefix is
   * reachable through the local storage host, so an object we have decided not to host must
   * not be left sitting there — least of all the one case that matters, an SVG carrying
   * script.
   */
  const reject = async (status: number, code: string) => {
    await storage.delete(key).catch(() => undefined)
    return fail(status, code)
  }

  const head = await storage.head(key)
  if (!head) return fail(400, 'missing_object')
  if (head.size <= 0 || head.size > MAX_BRAND_BYTES) return reject(413, 'too_large')
  const source = await storage.get(key)
  if (!source) return fail(400, 'missing_object')

  const isSvg = key.endsWith('.svg')
  let width: number
  let height: number
  let body: Uint8Array
  let contentType: string
  try {
    const meta = await sharp(Buffer.from(source)).metadata()
    if (!meta.width || !meta.height) return reject(415, 'unsupported_type')
    width = meta.width
    height = meta.height
    if (isSvg) {
      if (meta.format !== 'svg') return reject(415, 'unsupported_type')
      const text = new TextDecoder().decode(source)
      if (SVG_FORBIDDEN.test(text)) return reject(415, 'unsafe_svg')
      body = source
      contentType = 'image/svg+xml'
    } else {
      if (!['png', 'jpeg', 'webp', 'avif'].includes(meta.format ?? ''))
        return reject(415, 'unsupported_type')
      // Re-encode rather than copy: metadata is dropped and the orientation flag is applied.
      body = new Uint8Array(
        await sharp(Buffer.from(source)).rotate().png({ compressionLevel: 9 }).toBuffer(),
      )
      contentType = 'image/png'
    }
  } catch {
    return reject(415, 'unsupported_type')
  }

  const publicKey = `brand/${slot}-${key.slice(key.lastIndexOf('-') + 1, key.lastIndexOf('.'))}.${isSvg ? 'svg' : 'png'}`
  await storage.put(publicKey, body, {
    contentType,
    cacheControl: 'public, max-age=31536000, immutable',
  })

  const db = await getDb()
  const before = brandSettingSchema.parse((await getSetting<unknown>(db, 'brand', {})) ?? {})
  const asset = { key: publicKey, width, height, type: contentType }
  const value = { ...before, [slot]: asset }
  const now = new Date()
  await db
    .insert(settings)
    .values({ key: 'brand', value, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: user.id, updatedAt: now },
    })
  // The original has served its purpose; leaving it would keep an unvalidated file around.
  await storage.delete(key).catch(() => undefined)
  purgeSettings()
  await audit({
    actorId: user.id,
    action: 'settings.brand_asset',
    targetType: 'settings',
    before: { [slot]: before[slot] },
    after: { [slot]: asset },
    request,
  })
  return ok({ slot, asset: { ...asset, url: storageUrl(publicKey) } })
})

/** DELETE — clear one slot and go back to the built-in mark. The object itself is removed. */
export const DELETE = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, brandAssetSlotSchema)
  if (!parsed.ok) return parsed.response
  const { slot } = parsed.data
  const db = await getDb()
  const before = brandSettingSchema.parse((await getSetting<unknown>(db, 'brand', {})) ?? {})
  const gone = before[slot]
  const value = { ...before, [slot]: null }
  const now = new Date()
  await db
    .insert(settings)
    .values({ key: 'brand', value, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: user.id, updatedAt: now },
    })
  if (gone) {
    const storage = await getStorage()
    await storage.delete(gone.key).catch(() => undefined)
  }
  purgeSettings()
  await audit({
    actorId: user.id,
    action: 'settings.brand_asset',
    targetType: 'settings',
    before: { [slot]: gone },
    after: { [slot]: null },
    request,
  })
  return ok({ slot, asset: null })
})
