import { can, type Permission } from '@palscans/core'
import { z } from 'zod'
import { MAX_FILE_BYTES } from '@/components/admin/schemas'
import { fail, ok, parseQuery, readBody, withPermission } from '@/lib/auth'
import { getEnv } from '@/lib/env'
import { getStorage, sniffImage, verifyUploadSignature } from '@/lib/storage'

/**
 * PUT /api/upload/put?key=…&exp=…&bytes=…&sig=… — the fs-driver stand-in for a presigned
 * PUT (docs/03 step 5). Only keys minted by an upload intent are accepted: the query carries
 * an HMAC over key, content type, uploader, expiry and size (`presignUpload`), so a key is
 * written only by the user an intent was minted for, before it expires, at the declared
 * size, and never over an existing object (keys are content-addressed). The body is read
 * through a streaming cap — Content-Length first, then chunk by chunk — so an oversized
 * PUT is cut off rather than buffered. Never enabled with the S3 driver.
 *
 * Three key shapes are minted, and each carries its own permission (`KEY_KINDS`): chapter
 * pages, series artwork, and the brand assets Appearance → Brand uploads. The route is gated
 * on `admin.access` and then checks the specific permission for the shape, so an operator who
 * may change settings but not touch chapters can still upload a logo — and, just as
 * importantly, the reverse stays true.
 */
const keySchema = z.object({
  key: z
    .string()
    .regex(
      /^(uploads\/\d+\/\d+\/\d{4}-[a-f0-9]{12}\.(jpg|png|webp|avif|gif)|uploads\/art\/\d+\/[a-f0-9]{12}\.(jpg|png|webp|avif)|uploads\/brand\/(logo_dark|logo_light|monogram|social_image)-[a-f0-9]{12}\.(jpg|png|webp|avif|svg))$/,
    ),
  exp: z.coerce.number().int().positive(),
  bytes: z.coerce.number().int().positive().max(MAX_FILE_BYTES),
  sig: z.string().regex(/^[a-f0-9]{64}$/),
})

const KEY_KINDS: ReadonlyArray<{ prefix: string; permission: Permission }> = [
  { prefix: 'uploads/art/', permission: 'series.update' },
  { prefix: 'uploads/brand/', permission: 'settings.write' },
]

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
/**
 * SVG is accepted only for a brand asset. It is not sniffed by magic bytes — an SVG is text —
 * so it is checked for a root `<svg` element here and then fully validated (and refused if it
 * carries script) by the confirm step in `/api/admin/appearance/brand/asset`.
 */
const BRAND_TYPES = new Set([...TYPES, 'image/svg+xml'])

const looksLikeSvg = (body: Uint8Array): boolean =>
  /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(
    new TextDecoder().decode(body.subarray(0, 512)),
  )

export const PUT = withPermission('admin.access', async (request, _ctx, user) => {
  if (getEnv().STORAGE_DRIVER !== 'fs') return fail(404, 'not_found')
  const query = parseQuery(request, keySchema)
  if (!query.ok) return query.response
  const { key, exp, bytes, sig } = query.data
  const kind = KEY_KINDS.find((k) => key.startsWith(k.prefix))
  // Chapter pages are the default shape and keep the permission this route always required.
  if (!can(user, kind?.permission ?? 'chapter.create')) return fail(403, 'forbidden')
  const isBrand = key.startsWith('uploads/brand/')
  const declared = request.headers.get('content-type') ?? ''
  if (!(isBrand ? BRAND_TYPES : TYPES).has(declared)) return fail(415, 'unsupported_type')
  if (!verifyUploadSignature(sig, key, declared, user.id, exp, bytes))
    return fail(403, 'bad_signature')
  const storage = await getStorage()
  if (await storage.exists(key)) return fail(409, 'exists')
  const read = await readBody(request, bytes, { requireLength: true })
  if (!read.ok) return read.response
  const body = read.body
  if (body.byteLength !== bytes) return fail(413, 'too_large')
  if (declared === 'image/svg+xml') {
    if (!isBrand || !looksLikeSvg(body)) return fail(415, 'unsupported_type')
  } else {
    const sniffed = sniffImage(body)
    if (!sniffed || sniffed !== declared) return fail(415, 'unsupported_type')
  }
  await storage.put(key, body, {
    contentType: declared,
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return ok({ key, bytes: body.byteLength })
})
