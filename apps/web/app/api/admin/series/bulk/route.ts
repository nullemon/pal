import { getDb, series } from '@palscans/db'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'

/**
 * Bulk edits on series.
 *
 * Users, comments and chapters all had one of these; series did not, so changing state on
 * twenty rows was twenty page loads. The shape follows the chapters route deliberately —
 * same discriminated union, same per-action permission check, same audit row — because two
 * bulk endpoints that behave differently is how one of them ends up with a gap nobody notices.
 *
 * The permission is derived per action rather than taken from the route, so a moderator with
 * `series.update` can change state and feature rows without also being able to delete them.
 */
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_state'),
    ids: z.array(z.number().int()).min(1).max(500),
    // The series states an operator sets deliberately. `scheduled` is driven by a date and
    // `removed` is what delete does, so neither belongs on a dropdown. `ready` is a *chapter*
    // state and was in the first draft of this — the column type refused it.
    state: z.enum(['draft', 'published', 'unlisted']),
  }),
  z.object({ action: z.literal('feature'), ids: z.array(z.number().int()).min(1).max(500) }),
  z.object({ action: z.literal('unfeature'), ids: z.array(z.number().int()).min(1).max(500) }),
  z.object({ action: z.literal('pin'), ids: z.array(z.number().int()).min(1).max(500) }),
  z.object({ action: z.literal('unpin'), ids: z.array(z.number().int()).min(1).max(500) }),
  z.object({ action: z.literal('delete'), ids: z.array(z.number().int()).min(1).max(500) }),
  z.object({ action: z.literal('restore'), ids: z.array(z.number().int()).min(1).max(500) }),
])

export const POST = withPermission('series.update', async (request, _ctx, user) => {
  const parsed = await parseJson(request, bodySchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const { can } = await import('@palscans/core')
  const needs =
    body.action === 'delete' || body.action === 'restore'
      ? 'series.delete'
      : body.action === 'feature' || body.action === 'unfeature'
        ? 'series.feature'
        : 'series.update'
  if (!can(user, needs)) return Response.json({ error: 'forbidden' }, { status: 403 })

  const db = await getDb()
  const now = new Date()
  // Typed explicitly: the ternary chain otherwise widens to a union of object shapes whose
  // absent keys are `undefined`, which drizzle's update signature will not take.
  const set: Partial<typeof series.$inferInsert> =
    body.action === 'set_state'
      ? { state: body.state, updatedAt: now }
      : body.action === 'feature' || body.action === 'unfeature'
        ? { isFeatured: body.action === 'feature', updatedAt: now }
        : body.action === 'pin' || body.action === 'unpin'
          ? { isPinned: body.action === 'pin', updatedAt: now }
          : { deletedAt: body.action === 'delete' ? now : null, updatedAt: now }

  await db.update(series).set(set).where(inArray(series.id, body.ids))

  await audit({
    actorId: user.id,
    action: `series.bulk.${body.action}`,
    targetType: 'series',
    after: { ids: body.ids.slice(0, 50), count: body.ids.length },
  })
  await purgeCatalog()
  return ok({ affected: body.ids.length })
})
