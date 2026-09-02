import { getQueue } from '@palscans/core/queue'
import { getDb, type SeriesArtPending, series } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { artConfirmSchema, artIntentSchema } from '@/components/admin/schemas'
import { audit } from '@/components/admin/server/audit'
import { idParam } from '@/components/admin/server/params'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'
import { getStorage, presignUpload, verifyUploadedObject } from '@/lib/storage'

const ext: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

/** docs/03: covers and banners are ≤ 20 MB originals (the schema caps `bytes` the same way). */
export const MAX_ART_BYTES = 20 * 1024 * 1024
const ART_TYPES = new Set(Object.keys(ext))

/**
 * POST /api/admin/series/:id/art — presign a cover/banner upload. The original lands under
 * `uploads/art/<series>/<sha12>.<ext>`, never under the public `covers/` / `banners/`
 * prefixes: the worker's `series.art` job re-encodes it (orientation, metadata stripped,
 * three widths, AVIF + WebP) and only then does the series point at a public key.
 */
export const POST = withPermission<{ id: string }>('series.update', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, artIntentSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const [row] = await db
    .select({ id: series.id })
    .from(series)
    .where(eq(series.id, id.data))
    .limit(1)
  if (!row) return notFound()
  const key = `uploads/art/${row.id}/${parsed.data.sha256.slice(0, 12)}.${ext[parsed.data.type]}`
  const signed = await presignUpload(key, parsed.data.type, user.id, parsed.data.bytes)
  return ok({ key, url: signed.url, method: signed.method, headers: signed.headers })
})

/**
 * PATCH /api/admin/series/:id/art — confirm an uploaded original: it must exist, be within
 * the cap, carry an allowed type and start with that type's magic bytes (HEAD + a 16-byte
 * range, never the body). It is then queued for re-encoding; `coverKey` / `bannerKey`
 * change only when the job completes, so an original is never served publicly.
 */
export const PATCH = withPermission<{ id: string }>('series.update', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, artConfirmSchema)
  if (!parsed.ok) return parsed.response
  const { kind, key } = parsed.data
  if (!key.startsWith(`uploads/art/${id.data}/`)) return fail(400, 'validation')
  const storage = await getStorage()
  const check = await verifyUploadedObject(storage, key, {
    maxBytes: MAX_ART_BYTES,
    types: ART_TYPES,
  })
  if (!check.ok)
    return check.code === 'missing'
      ? fail(400, 'missing_object')
      : fail(check.code === 'too_large' ? 413 : 415, check.code)
  const db = await getDb()
  const [before] = await db
    .select({
      coverKey: series.coverKey,
      bannerKey: series.bannerKey,
      artPending: series.artPending,
    })
    .from(series)
    .where(eq(series.id, id.data))
    .limit(1)
  if (!before) return notFound()
  const now = new Date()
  const pending: SeriesArtPending = {
    ...(before.artPending ?? {}),
    [kind]: { key, requestedAt: now.toISOString(), requestedBy: user.id },
  }
  await db.update(series).set({ artPending: pending, updatedAt: now }).where(eq(series.id, id.data))
  let jobId: string | null = null
  try {
    const queue = await getQueue()
    jobId = await queue.add(
      'series.art',
      { seriesId: id.data, kind, key },
      { jobId: `series.art:${id.data}:${kind}:${key.slice(-16)}`, attempts: 3 },
    )
  } catch {
    // no queue reachable: the worker's scheduler pass picks the pending entry up
  }
  const column = kind === 'cover' ? 'coverKey' : 'bannerKey'
  await audit({
    actorId: user.id,
    action: `series.${kind}`,
    targetType: 'series',
    targetId: id.data,
    before: { [column]: before[column] },
    after: { pending: key, bytes: check.bytes, jobId },
    request,
  })
  return ok({ key, url: null, pending: true, jobId })
})
