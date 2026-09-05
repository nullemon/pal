import { messages } from '@palscans/core/messages'
import { getDb, takedowns } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { audit, snapshot } from '@/components/admin/server/audit'
import { idParam } from '@/components/admin/server/params'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * `POST /api/admin/takedowns/:id` — the three transitions of a DMCA notice (docs/07
 * "Content compliance"). Each call moves the row between the states documented on the
 * `takedowns` schema and writes the `audit_log` row that carries the staff note, the same
 * way the reports queue records its own decisions.
 *
 *   acknowledge  action = 'acknowledged', still open — the claimant has been answered
 *   accept       action = 'removed',   actioned_at = now
 *   reject       action = 'rejected',  actioned_at = now
 *
 * Accepting records the *decision*. Taking the title itself down remains the series editor's
 * `state = 'removed'` path, which is what hides it from every feed and purges the CDN; the
 * queue links straight to the series so the two steps sit next to each other.
 */

const ACTIONS = {
  acknowledge: 'acknowledged',
  accept: 'removed',
  reject: 'rejected',
} as const

const schema = z.object({
  action: z.enum(['acknowledge', 'accept', 'reject']),
  note: z.string().trim().max(2000).optional(),
})

export const POST = withPermission<{ id: string }>('report.handle', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, schema)
  if (!parsed.ok) return parsed.response
  const { action, note } = parsed.data

  // Closing a notice is the decision a safe-harbour argument later rests on, so it is never
  // recorded without a reason. Acknowledging is not a decision and needs none.
  if (action !== 'acknowledge' && !note)
    return fail(400, 'note_required', messages.takedowns.noteRequired)

  const db = await getDb()
  const [before] = await db
    .select({
      action: takedowns.action,
      actionedAt: takedowns.actionedAt,
      createdBy: takedowns.createdBy,
    })
    .from(takedowns)
    .where(eq(takedowns.id, id.data))
    .limit(1)
  if (!before) return notFound()

  const next = ACTIONS[action]
  const actionedAt = action === 'acknowledge' ? null : new Date()
  await db
    .update(takedowns)
    .set({ action: next, actionedAt, createdBy: user.id })
    .where(eq(takedowns.id, id.data))

  await audit({
    actorId: user.id,
    action: `takedown.${action}`,
    targetType: 'takedown',
    targetId: id.data,
    before: snapshot(before),
    after: { action: next, actionedAt: actionedAt?.toISOString() ?? null, note: note ?? null },
    request,
  })
  return ok({ id: id.data, action: next, actionedAt: actionedAt?.toISOString() ?? null })
})
