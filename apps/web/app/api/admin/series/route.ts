import { slugify, uniqueSlug } from '@palscans/core'
import { getDb, series } from '@palscans/db'
import { ilike } from 'drizzle-orm'
import { seriesCreateSchema } from '@/components/admin/schemas'
import { audit } from '@/components/admin/server/audit'
import { ok, parseJson, withPermission } from '@/lib/auth'

/** POST /api/admin/series { title, type } → { id, slug } */
export const POST = withPermission('series.create', async (request, _ctx, user) => {
  const parsed = await parseJson(request, seriesCreateSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const base = slugify(parsed.data.title)
  const taken = await db
    .select({ slug: series.slug })
    .from(series)
    .where(ilike(series.slug, `${base}%`))
  const slug = uniqueSlug(
    base,
    taken.map((t) => t.slug),
  )
  const [row] = await db
    .insert(series)
    .values({ title: parsed.data.title, slug, type: parsed.data.type, state: 'draft' })
    .returning({ id: series.id, slug: series.slug })
  if (!row) throw new Error('insert failed')
  await audit({
    actorId: user.id,
    action: 'series.create',
    targetType: 'series',
    targetId: row.id,
    after: { title: parsed.data.title, slug, type: parsed.data.type },
    request,
  })
  return ok(row)
})
