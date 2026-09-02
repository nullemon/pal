import { getDb, redirects } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { notFound, ok, parseJson, withPermission } from '@/lib/auth'
import { redirectInputSchema } from '@/lib/seo/admin'
import { listRedirects } from '@/lib/seo/admin-data'

/** The redirects table (docs/12 §8): list, upsert one, delete one. */
export const GET = withPermission('settings.write', async () => {
  const db = await getDb()
  return ok({ redirects: await listRedirects(db) })
})

export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, redirectInputSchema)
  if (!parsed.ok) return parsed.response
  const { from, to, status } = parsed.data
  const db = await getDb()
  const [row] = await db
    .insert(redirects)
    .values({ fromPath: from, toPath: to, status, createdBy: user.id })
    .onConflictDoUpdate({
      target: redirects.fromPath,
      set: { toPath: to, status, createdBy: user.id, deletedAt: null },
    })
    .returning()
  await audit({
    actorId: user.id,
    action: 'seo.redirect.upsert',
    targetType: 'redirects',
    targetId: row?.id ?? null,
    after: { from, to, status },
    request,
  })
  revalidateTag('redirects', 'max')
  return ok({ redirect: row })
})

const deleteSchema = z.object({ id: z.number().int().positive() })

export const DELETE = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, deleteSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const [row] = await db
    .update(redirects)
    .set({ deletedAt: new Date() })
    .where(and(eq(redirects.id, parsed.data.id), isNull(redirects.deletedAt)))
    .returning()
  if (!row) return notFound()
  await audit({
    actorId: user.id,
    action: 'seo.redirect.delete',
    targetType: 'redirects',
    targetId: row.id,
    before: { from: row.fromPath, to: row.toPath, status: row.status, hits: Number(row.hits) },
    request,
  })
  revalidateTag('redirects', 'max')
  return ok({ id: row.id })
})
