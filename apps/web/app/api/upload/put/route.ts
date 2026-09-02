import { z } from 'zod'
import { MAX_FILE_BYTES } from '@/components/admin/schemas'
import { fail, ok, parseQuery, withPermission } from '@/lib/auth'
import { getEnv } from '@/lib/env'
import { getStorage, sniffImage } from '@/lib/storage'

/**
 * PUT /api/upload/put?key=… — the fs-driver stand-in for a presigned PUT (docs/03 step 5).
 * Only keys minted by an upload intent are accepted: `uploads/<series>/<chapter>/…` (pages)
 * and `covers|banners/<slug>/<sha12>.<ext>` (series art). Never enabled with the S3 driver.
 */
const keySchema = z.object({
  key: z
    .string()
    .regex(
      /^(uploads\/\d+\/\d+\/\d{4}-[a-f0-9]{12}\.(jpg|png|webp|avif|gif)|(covers|banners)\/[a-z0-9-]+\/[a-f0-9]{12}\.(jpg|png|webp|avif))$/,
    ),
})

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])

export const PUT = withPermission('chapter.create', async (request) => {
  if (getEnv().STORAGE_DRIVER !== 'fs') return fail(404, 'not_found')
  const query = parseQuery(request, keySchema)
  if (!query.ok) return query.response
  const declared = request.headers.get('content-type') ?? ''
  if (!TYPES.has(declared)) return fail(415, 'unsupported_type')
  const body = new Uint8Array(await request.arrayBuffer())
  if (body.byteLength === 0 || body.byteLength > MAX_FILE_BYTES) return fail(413, 'too_large')
  const sniffed = sniffImage(body)
  if (!sniffed || sniffed !== declared) return fail(415, 'unsupported_type')
  const storage = await getStorage()
  await storage.put(query.data.key, body, {
    contentType: declared,
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return ok({ key: query.data.key, bytes: body.byteLength })
})
