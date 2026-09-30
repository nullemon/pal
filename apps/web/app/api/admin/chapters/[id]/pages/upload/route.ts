import { chapters, getDb } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { idParam } from '@/components/admin/server/params'
import { notFound, ok, parseJson, withPermission } from '@/lib/auth'
import { MAX_ORIGINAL_BYTES } from '@/lib/storage'
import { presignUpload } from '@/lib/storage/upload'

/**
 * Presign a single replacement or inserted page.
 *
 * Separate from `/api/upload/intent`, which is shaped around creating chapters from a batch
 * of files and would have to grow a mode that skips most of what it does. This asks a much
 * smaller question — one file, one existing chapter — and `chapter.repair` is the right gate
 * for it, where intent needs `chapter.create`.
 *
 * The object is not trusted on the strength of this call. The browser PUTs it directly to
 * storage, so size and type are re-checked against the store in the commit below, exactly as
 * the upload flow does.
 */

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

const body = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']),
  bytes: z.number().int().positive().max(MAX_ORIGINAL_BYTES),
})

export const POST = withPermission<{ id: string }>('chapter.repair', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, body)
  if (!parsed.ok) return parsed.response

  const db = await getDb()
  const [row] = await db
    .select({ seriesId: chapters.seriesId })
    .from(chapters)
    .where(and(eq(chapters.id, id.data), isNull(chapters.deletedAt)))
    .limit(1)
  if (!row) return notFound()

  // Content-addressed, and under the prefix the commit validates. Re-uploading the same
  // image lands on the same key, which makes a retried upload free rather than a duplicate.
  const key = `uploads/${row.seriesId}/${id.data}/repair-${parsed.data.sha256.slice(0, 12)}.${
    EXT[parsed.data.type]
  }`
  const signed = await presignUpload(key, parsed.data.type, user.id, parsed.data.bytes)
  return ok({ key, url: signed.url, method: signed.method, headers: signed.headers })
})
