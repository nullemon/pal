import { getDb } from '@palscans/db'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { cleanLinks, deleteGroup, updateGroup } from '@/components/admin/server/groups'
import { idParam } from '@/components/admin/server/params'
import { notFound, ok, parseJson, withPermission } from '@/lib/auth'

const body = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).nullable(),
    links: z.record(z.string(), z.string()),
  })
  .partial()

export const PATCH = withPermission<{ id: string }>('series.update', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, body)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const changed = await updateGroup(
    id.data,
    {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.links !== undefined ? { links: cleanLinks(parsed.data.links) } : {}),
    },
    db,
  )
  if (!changed) return notFound()
  await audit({
    actorId: user.id,
    action: 'group.update',
    targetType: 'group',
    targetId: id.data,
    after: parsed.data,
  })
  await purgeCatalog()
  return ok({ ok: true })
})

/**
 * Soft delete. `chapter_groups` rows are left in place — see the note on `deleteGroup`: they
 * would otherwise strip attribution from every chapter the group ever worked on, with nothing
 * recording which ones they were.
 */
export const DELETE = withPermission<{ id: string }>(
  'series.update',
  async (_request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const db = await getDb()
    if (!(await deleteGroup(id.data, db))) return notFound()
    await audit({
      actorId: user.id,
      action: 'group.delete',
      targetType: 'group',
      targetId: id.data,
    })
    await purgeCatalog()
    return ok({ ok: true })
  },
)
