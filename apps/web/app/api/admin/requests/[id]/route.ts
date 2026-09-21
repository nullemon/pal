import { messages } from '@palscans/core/messages'
import {
  getDb,
  mergeRequests,
  REQUEST_STATUSES,
  requestById,
  series,
  setRequestStatus,
} from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { audit, snapshot } from '@/components/admin/server/audit'
import { idParam } from '@/components/admin/server/params'
import { toRequestItem } from '@/components/requests/server/data'
import { notifyRequester } from '@/components/requests/server/notify'
import type { RequestStatusValue } from '@/components/requests/shared'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * `POST /api/admin/requests/:id` — triage one request (docs/04 admin conventions).
 *
 * Permission: **`report.handle`**, the one moderators already hold for the reports queue and
 * the DMCA ledger. A request board is reader-submitted content that staff answer publicly,
 * which is the same job as those two; a new permission would only mean every existing
 * moderator has to be granted something before they can do work they are already trusted
 * with, and every role table in docs/04 would need a new column for no gain.
 *
 * Two actions, both writing `audit_log` like every other mutating admin route:
 *
 *   status  open · planned · added · exists · declined. `added` and `exists` need the series
 *           that answers the request (the database refuses them without one, which is what
 *           makes the "Read it" link on the public board safe to render); `declined` needs a
 *           reason, because it is shown to the reader who asked.
 *   merge   fold this request into another, moving its votes.
 *
 * A terminal status notifies the requester when they were signed in — through the same
 * `notifications` table everything else uses.
 */

const statusAction = z.object({
  action: z.literal('status'),
  status: z.enum(REQUEST_STATUSES),
  seriesId: z.number().int().positive().nullable().optional(),
  declineReason: z.string().trim().max(500).optional(),
})

const mergeAction = z.object({
  action: z.literal('merge'),
  targetId: z.number().int().positive(),
})

const schema = z.discriminatedUnion('action', [statusAction, mergeAction])

const m = messages.requests.admin

export const POST = withPermission<{ id: string }>('report.handle', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, schema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const db = await getDb()
  const before = await requestById(db, id.data)
  if (!before) return notFound()

  if (body.action === 'merge') {
    const merged = await mergeRequests(db, id.data, body.targetId)
    if (!merged.ok)
      return fail(
        400,
        merged.reason,
        merged.reason === 'self'
          ? m.mergeSelf
          : merged.reason === 'target_merged'
            ? m.mergeTargetMerged
            : m.mergeMissing,
      )
    await audit({
      actorId: user.id,
      action: 'series_request.merge',
      targetType: 'series_request',
      targetId: id.data,
      before: snapshot({ ...before }, ['title', 'status', 'voteCount']),
      after: { mergedInto: body.targetId, votesMoved: merged.moved },
    })
    return ok({
      merged: true,
      moved: merged.moved,
      target: toRequestItem(merged.target, false),
    })
  }

  const status = body.status as RequestStatusValue
  const needsSeries = status === 'added' || status === 'exists'
  const seriesId = body.seriesId ?? null
  if (needsSeries && !seriesId) return fail(400, 'series_required', m.seriesRequired)
  if (status === 'declined' && !body.declineReason)
    return fail(400, 'reason_required', m.declineReasonRequired)
  if (seriesId) {
    // Never point the public board at a deleted title.
    const [row] = await db
      .select({ id: series.id })
      .from(series)
      .where(and(eq(series.id, seriesId), isNull(series.deletedAt)))
      .limit(1)
    if (!row) return fail(400, 'series_missing', m.seriesRequired)
  }

  const updated = await setRequestStatus(db, {
    id: id.data,
    status,
    seriesId: needsSeries ? seriesId : null,
    declineReason: body.declineReason ?? null,
    actorId: user.id,
  })
  if (!updated) return notFound()

  const notified = await notifyRequester({
    userId: updated.userId,
    status,
    title: updated.title,
    seriesHref: updated.seriesSlug ? `/series/${updated.seriesSlug}` : null,
    declineReason: updated.declineReason,
  })

  await audit({
    actorId: user.id,
    action: `series_request.${status}`,
    targetType: 'series_request',
    targetId: id.data,
    before: snapshot({ ...before }, ['status', 'seriesId', 'declineReason']),
    after: {
      status,
      seriesId: updated.seriesId,
      declineReason: updated.declineReason,
      notified,
    },
  })
  return ok({ request: toRequestItem(updated, false), notified })
})
