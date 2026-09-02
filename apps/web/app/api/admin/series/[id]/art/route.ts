import { getDb, series } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { artConfirmSchema, artIntentSchema } from '@/components/admin/schemas'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { idParam } from '@/components/admin/server/params'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'
import { getStorage, presignUpload, storageUrl } from '@/lib/storage'

const ext: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

/** POST /api/admin/series/:id/art — presign a cover/banner upload (content-addressed key). */
export const POST = withPermission<{ id: string }>('series.update', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, artIntentSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const [row] = await db
    .select({ slug: series.slug })
    .from(series)
    .where(eq(series.id, id.data))
    .limit(1)
  if (!row) return notFound()
  const folder = parsed.data.kind === 'cover' ? 'covers' : 'banners'
  const key = `${folder}/${row.slug}/${parsed.data.sha256.slice(0, 12)}.${ext[parsed.data.type]}`
  const signed = await presignUpload(key, parsed.data.type, user.id)
  return ok({ key, url: signed.url, method: signed.method, headers: signed.headers })
})

/** PATCH /api/admin/series/:id/art — confirm the uploaded key as the cover or banner. */
export const PATCH = withPermission<{ id: string }>('series.update', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, artConfirmSchema)
  if (!parsed.ok) return parsed.response
  const storage = await getStorage()
  if (!(await storage.exists(parsed.data.key))) return fail(400, 'missing_object')
  const db = await getDb()
  const [before] = await db
    .select({ coverKey: series.coverKey, bannerKey: series.bannerKey })
    .from(series)
    .where(eq(series.id, id.data))
    .limit(1)
  if (!before) return notFound()
  const column = parsed.data.kind === 'cover' ? 'coverKey' : 'bannerKey'
  await db
    .update(series)
    .set({ [column]: parsed.data.key, updatedAt: new Date() })
    .where(eq(series.id, id.data))
  await audit({
    actorId: user.id,
    action: `series.${parsed.data.kind}`,
    targetType: 'series',
    targetId: id.data,
    before: { [column]: before[column] },
    after: { [column]: parsed.data.key },
    request,
  })
  purgeCatalog()
  return ok({ key: parsed.data.key, url: storageUrl(parsed.data.key) })
})
