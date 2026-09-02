import { getStorage } from '@palscans/core/storage'
import { z } from 'zod'
import { fail, ok, parseQuery, requireUser } from '@/lib/auth'

const MAX = 2 * 1024 * 1024
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const querySchema = z.object({
  key: z.string().regex(/^avatars\/\d+\/[a-f0-9]{16}\.(png|jpg|webp)$/),
})

const MAGIC: Array<{ type: string; test: (b: Uint8Array) => boolean }> = [
  {
    type: 'image/png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/webp',
    test: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45,
  },
]

/** PUT /api/me/avatar/upload?key=… — the fs-driver stand-in for a presigned PUT (own key only). */
export const PUT = requireUser(async (request, _ctx, user) => {
  const query = parseQuery(request, querySchema)
  if (!query.ok) return query.response
  if (!query.data.key.startsWith(`avatars/${user.id}/`)) return fail(403, 'forbidden')
  const type = request.headers.get('content-type') ?? ''
  if (!TYPES.has(type)) return fail(415, 'unsupported_type')
  const body = new Uint8Array(await request.arrayBuffer())
  if (body.byteLength === 0 || body.byteLength > MAX) return fail(413, 'too_large')
  if (!MAGIC.some((m) => m.type === type && m.test(body))) return fail(415, 'unsupported_type')
  const storage = await getStorage()
  await storage.put(query.data.key, body, {
    contentType: type,
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return ok({ key: query.data.key })
})
