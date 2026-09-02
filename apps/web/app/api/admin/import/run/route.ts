import { describeImportSource, importSourceReady, maskImportSetting } from '@palscans/core/import'
import { messages } from '@palscans/core/messages'
import { z } from 'zod'
import {
  controlRun,
  latestRunView,
  liveRunView,
  RunBusyError,
  startRun,
} from '@/app/admin/import/run-service'
import { readImportDoc } from '@/app/admin/import/service'
import { audit } from '@/components/admin/server/audit'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * The import run's controls (docs/17 §E). Starting only enqueues: the worker does the
 * importing, so this route stays fast and the panel polls GET for progress.
 */

/** GET — the live run, or the last finished one, so the panel always has something to show. */
export const GET = withPermission('settings.write', async () => ok(await latestRunView()))

/** POST — create and enqueue a run for the stored source configuration. */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const doc = await readImportDoc()
  if (!importSourceReady(doc.config))
    return fail(400, 'validation', messages.admin.import.runUnavailable)
  if (await liveRunView()) return fail(409, 'conflict', messages.admin.import.runBusy)

  try {
    // The stored config is copied onto the run masked, so the row is safe to read back.
    const view = await startRun(
      describeImportSource(doc.config),
      maskImportSetting(doc.config) as unknown as Record<string, unknown>,
      user.id,
    )
    await audit({
      actorId: user.id,
      action: 'import.start',
      targetType: 'import_run',
      targetId: view.id,
      after: { source: view.source, mode: doc.config.mode },
      request,
    })
    return ok(view)
  } catch (err) {
    if (err instanceof RunBusyError) return fail(409, 'conflict', messages.admin.import.runBusy)
    throw err
  }
})

const actionSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(['pause', 'resume', 'cancel']),
})

/** PATCH — pause, resume or cancel. Pause and cancel are requests the runner honours between batches. */
export const PATCH = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, actionSchema)
  if (!parsed.ok) return parsed.response
  const view = await controlRun(parsed.data.id, parsed.data.action)
  if (!view) return fail(404, 'not_found')
  await audit({
    actorId: user.id,
    action: `import.${parsed.data.action}`,
    targetType: 'import_run',
    targetId: view.id,
    after: { status: view.status, phase: view.phase },
    request,
  })
  return ok(view)
})
