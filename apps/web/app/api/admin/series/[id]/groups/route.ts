import { normaliseLanguage } from '@palscans/core/languages'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { setSeriesGroups } from '@/components/admin/server/groups'
import { idParam } from '@/components/admin/server/params'
import { notFound, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * PUT /api/admin/series/:id/groups — credit these groups on every chapter of the series.
 *
 * `chapter.update`, not `series.update`: this writes chapter credits, and crediting the work
 * is the uploader's job. Inventing a group is a different gate, which is why this takes ids
 * rather than names.
 *
 * Replaces rather than adds, like the per-chapter action: the picker sends the whole answer,
 * and merging would make removing a wrong credit impossible from the only screen that sets
 * one. An empty list is therefore how you clear the credit, deliberately.
 */
const body = z.object({
  groupIds: z.array(z.number().int().positive()).max(20),
  /** Credit only one translation's chapters; absent means all of them. */
  language: z.string().max(16).optional(),
})

export const PUT = withPermission<{ id: string }>('chapter.update', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, body)
  if (!parsed.ok) return parsed.response
  const language = parsed.data.language ? normaliseLanguage(parsed.data.language) : null
  const result = await setSeriesGroups(id.data, parsed.data.groupIds, { language })
  await audit({
    actorId: user.id,
    action: 'series.set_groups',
    targetType: 'series',
    targetId: id.data,
    after: { groupIds: parsed.data.groupIds, language, chapters: result.chapters },
  })
  purgeCatalog()
  return ok(result)
})
