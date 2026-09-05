import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import {
  cancelWatermarkRun,
  currentWatermark,
  readWatermarkRun,
  startWatermarkRun,
  WatermarkRunBusyError,
  watermarkCounts,
} from '@/components/admin/server/watermark'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * The watermark re-apply (docs/03 "Re-applying the mark").
 *
 * Saving the watermark changes nothing that is already processed — every published chapter
 * keeps the pixels it was built with. This is where the operator closes that gap, and it is
 * a *job*: a catalogue-wide sweep is tens of thousands of CPU-bound encodes, so POST only
 * writes the run document and enqueues, and the panel polls GET for progress.
 */

/** GET — the live (or last) run plus how the catalogue stands against the current mark. */
export const GET = withPermission('settings.write', async () => {
  const { fingerprint, config } = await currentWatermark()
  const [run, counts] = await Promise.all([readWatermarkRun(), watermarkCounts(fingerprint)])
  return ok({ run, counts, enabled: config.enabled, text: config.text })
})

const startSchema = z.object({
  /** Chapter ids, or omitted for the whole catalogue. */
  ids: z.array(z.number().int().positive()).max(5_000).optional(),
})

export const POST = withPermission('chapter.repair', async (request, _ctx, user) => {
  const parsed = await parseJson(request, startSchema)
  if (!parsed.ok) return parsed.response
  try {
    const run = await startWatermarkRun(parsed.data.ids ?? null, user.id)
    await audit({
      actorId: user.id,
      action: 'watermark.reapply.start',
      targetType: 'settings',
      after: { runId: run.id, scope: run.scope?.length ?? 'all', mark: run.label || '(none)' },
      request,
    })
    const { fingerprint } = await currentWatermark()
    return ok({ run, counts: await watermarkCounts(fingerprint) })
  } catch (err) {
    if (err instanceof WatermarkRunBusyError) return fail(409, 'conflict')
    throw err
  }
})

const actionSchema = z.object({ action: z.literal('cancel') })

/** PATCH — ask the run to stop. Honoured between chapters, never mid-chapter. */
export const PATCH = withPermission('chapter.repair', async (request, _ctx, user) => {
  const parsed = await parseJson(request, actionSchema)
  if (!parsed.ok) return parsed.response
  const run = await cancelWatermarkRun(user.id)
  if (!run) return fail(404, 'not_found')
  await audit({
    actorId: user.id,
    action: 'watermark.reapply.cancel',
    targetType: 'settings',
    after: { runId: run.id, status: run.status },
    request,
  })
  const { fingerprint } = await currentWatermark()
  return ok({ run, counts: await watermarkCounts(fingerprint) })
})
