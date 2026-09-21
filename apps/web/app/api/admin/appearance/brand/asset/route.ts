import { appearanceSettings, getDb, getSetting } from '@palscans/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import {
  brandAssetConfirmSchema,
  brandAssetIntentSchema,
  brandAssetSlotSchema,
} from '@/components/admin/schemas-appearance'
import { audit } from '@/components/admin/server/audit'
import { type BrandDocument, scopeAdapter } from '@/lib/appearance/documents'
import { draftDocument, saveDraft } from '@/lib/appearance/versions'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'
import { BRAND_SLOTS, brandSettingSchema } from '@/lib/chrome/schema'
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
 * - **The setting it writes is the draft, not the live row.** Confirming an upload used to
 *   change the header immediately, which made "a draft you can edit without affecting the
 *   live site" untrue for the most visible field on the screen. The object still lands in
 *   storage at once — there is nowhere else for bytes to go — but nothing points at it until
 *   Brand is published.
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

  const before = await brandDraftBase()
  const asset = { key: publicKey, width, height, type: contentType }
  const id = await saveDraft('brand', { ...before, [slot]: asset }, user.id)
  // The original has served its purpose; leaving it would keep an unvalidated file around.
  await storage.delete(key).catch(() => undefined)
  await audit({
    actorId: user.id,
    action: 'settings.brand.draft_asset',
    targetType: 'appearance',
    targetId: id,
    before: { [slot]: before[slot] },
    after: { [slot]: asset },
  })
  return ok({ slot, asset: { ...asset, url: storageUrl(publicKey) } })
})

/**
 * DELETE — unlink one slot in the draft and go back to the built-in mark.
 *
 * **The object is only removed when no stored version still points at it.** Before Appearance
 * had history, deleting the setting and deleting the file were the same act and it cost
 * nothing; now every brand version records a key, and unlinking a mark from the live site is
 * not a reason to make five months of history unrestorable — a restore would come back with a
 * hole where the logo was. So the check below is the pair of `missingBrandAssets`: one keeps
 * a referenced object alive, the other refuses to publish a document whose object went away
 * anyway (bucket lifecycle rules, a restore from an older backup).
 *
 * An unreferenced object is still deleted immediately, which is what an operator who uploaded
 * the wrong image expects — including the case that matters, uploading something they should
 * not have and taking it straight back out.
 */
export const DELETE = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, brandAssetSlotSchema)
  if (!parsed.ok) return parsed.response
  const { slot } = parsed.data
  const before = await brandDraftBase()
  const gone = before[slot]
  const id = await saveDraft('brand', { ...before, [slot]: null }, user.id)
  let kept = false
  if (gone) {
    kept = await keyIsReferenced(gone.key, id)
    if (!kept) {
      const storage = await getStorage()
      await storage.delete(gone.key).catch(() => undefined)
    }
  }
  await audit({
    actorId: user.id,
    action: 'settings.brand.draft_asset',
    targetType: 'appearance',
    targetId: id,
    before: { [slot]: gone },
    after: { [slot]: null, object_kept: kept },
  })
  return ok({ slot, asset: null })
})

/**
 * The document an upload edits: the draft when there is one, otherwise a copy of what is
 * live. Uploading is the one Brand action that used to bypass the form's Save entirely, and
 * it now folds into the same draft — otherwise "edit a draft without affecting the live site"
 * would be false for the field operators change most visibly.
 */
const brandDraftBase = async (): Promise<BrandDocument> => {
  const db = await getDb()
  return (await draftDocument('brand', db)) ?? (await scopeAdapter('brand').live(db))
}

/** Is this object still named by the live row, or by any stored brand version but `exceptId`? */
const keyIsReferenced = async (key: string, exceptId: number): Promise<boolean> => {
  const db = await getDb()
  const live = brandSettingSchema.parse((await getSetting<unknown>(db, 'brand', {})) ?? {})
  if (BRAND_SLOTS.some((s) => live[s]?.key === key)) return true
  const rows = await db
    .select({ id: appearanceSettings.id, settings: appearanceSettings.settings })
    .from(appearanceSettings)
    .where(eq(appearanceSettings.scope, 'brand'))
  return rows.some((row) => row.id !== exceptId && JSON.stringify(row.settings).includes(key))
}
