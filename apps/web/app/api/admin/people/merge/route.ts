import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { mergePeople } from '@/components/admin/server/people'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * Fold one person into another.
 *
 * `series.delete`, matching the genre and series merges: a merge destroys a row, and once the
 * loser is gone its credits are indistinguishable from the winner's own, so there is nothing
 * left to undo it with. Listing and renaming sit on lighter gates.
 */
const body = z.object({
  winnerId: z.number().int().positive(),
  loserId: z.number().int().positive(),
})

export const POST = withPermission('series.delete', async (request, _ctx, user) => {
  const parsed = await parseJson(request, body)
  if (!parsed.ok) return parsed.response
  if (parsed.data.winnerId === parsed.data.loserId) return fail(400, 'validation')
  const result = await mergePeople(parsed.data.winnerId, parsed.data.loserId)
  if (!result) return fail(404, 'not_found')
  await audit({
    actorId: user.id,
    action: 'person.merge',
    targetType: 'person',
    targetId: parsed.data.winnerId,
    after: { loserId: parsed.data.loserId, moved: result.moved },
  })
  await purgeCatalog()
  return ok(result)
})
