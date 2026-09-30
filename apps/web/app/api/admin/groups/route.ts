import { getDb } from '@palscans/db'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { cleanLinks, createGroup, listGroups } from '@/components/admin/server/groups'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * Scanlation groups.
 *
 * `series.read` to list, because the chapter screens need the names to render a picker and
 * uploaders hold it; `series.update` to change the catalogue, which they do not. Assigning a
 * group to a chapter is a different gate again — see the chapters bulk route — since crediting
 * the work is the uploader's job and inventing a new group is not.
 */

const body = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  links: z.record(z.string(), z.string()).optional(),
})

export const GET = withPermission('series.read', async () => ok({ groups: await listGroups() }))

export const POST = withPermission('series.update', async (request, _ctx, user) => {
  const parsed = await parseJson(request, body)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const created = await createGroup(
    {
      name: parsed.data.name.trim(),
      description: parsed.data.description ?? null,
      links: cleanLinks(parsed.data.links),
    },
    db,
  )
  if (!created) return fail(500, 'insert_failed')
  await audit({
    actorId: user.id,
    action: 'group.create',
    targetType: 'group',
    targetId: created.id,
    after: { name: created.name, slug: created.slug },
  })
  await purgeCatalog()
  return ok({ group: created })
})
