import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { idParam } from '@/components/admin/server/params'
import { renamePerson } from '@/components/admin/server/people'
import { notFound, ok, parseJson, withPermission } from '@/lib/auth'

const body = z.object({ name: z.string().min(1).max(200) })

/** PATCH — rename. `series.update`, the same gate as editing the series that carry them. */
export const PATCH = withPermission<{ id: string }>('series.update', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, body)
  if (!parsed.ok) return parsed.response
  const name = parsed.data.name.trim()
  if (!(await renamePerson(id.data, name))) return notFound()
  await audit({
    actorId: user.id,
    action: 'person.rename',
    targetType: 'person',
    targetId: id.data,
    after: { name },
  })
  await purgeCatalog()
  return ok({ ok: true })
})
