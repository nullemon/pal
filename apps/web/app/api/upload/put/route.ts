import { can } from '@palscans/core'
import { z } from 'zod'
import { MAX_FILE_BYTES } from '@/components/admin/schemas'
import { fail, ok, parseQuery, withPermission } from '@/lib/auth'
import { getEnv } from '@/lib/env'
import { getStorage, sniffImage, verifyUploadSignature } from '@/lib/storage'

/**
 * PUT /api/upload/put?key=…&exp=…&sig=… — the fs-driver stand-in for a presigned PUT
 * (docs/03 step 5). Only keys minted by an upload intent are accepted: the query carries an
 * HMAC over key, content type, uploader and expiry (`presignUpload`), so a key is written
 * only by the user an intent was minted for, before it expires, and never over an existing
 * object (keys are content-addressed). Never enabled with the S3 driver.
 */
const keySchema = z.object({
  key: z
    .string()
    .regex(
      /^(uploads\/\d+\/\d+\/\d{4}-[a-f0-9]{12}\.(jpg|png|webp|avif|gif)|(covers|banners)\/[a-z0-9-]+\/[a-f0-9]{12}\.(jpg|png|webp|avif))$/,
    ),
  exp: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[a-f0-9]{64}$/),
})

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])

export const PUT = withPermission('chapter.create', async (request, _ctx, user) => {
  if (getEnv().STORAGE_DRIVER !== 'fs') return fail(404, 'not_found')
  const query = parseQuery(request, keySchema)
  if (!query.ok) return query.response
  const declared = request.headers.get('content-type') ?? ''
  if (!TYPES.has(declared)) return fail(415, 'unsupported_type')
  const { key, exp, sig } = query.data
  if (!verifyUploadSignature(sig, key, declared, user.id, exp)) return fail(403, 'bad_signature')
  if (!key.startsWith('uploads/') && !can(user, 'series.update')) return fail(403, 'forbidden')
  const storage = await getStorage()
  if (await storage.exists(key)) return fail(409, 'exists')
  const body = new Uint8Array(await request.arrayBuffer())
  if (body.byteLength === 0 || body.byteLength > MAX_FILE_BYTES) return fail(413, 'too_large')
  const sniffed = sniffImage(body)
  if (!sniffed || sniffed !== declared) return fail(415, 'unsupported_type')
  await storage.put(key, body, {
    contentType: declared,
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return ok({ key, bytes: body.byteLength })
})
