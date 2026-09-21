import { getQueue } from '@palscans/core/queue'
import { readLastBackup } from '@/app/admin/system/backup/service'
import { audit } from '@/components/admin/server/audit'
import { fail, ok, withPermission } from '@/lib/auth'

/**
 * `Admin → System → Backup` (docs/17 §G). Both verbs are thin on purpose: the worker owns
 * `db.backup` — it is the process with `pg_dump` and the credentials for the private backups
 * bucket — so this route only enqueues the same job the nightly schedule enqueues, and reads
 * back the outcome the worker recorded.
 */

/** GET — the last recorded run, so the panel can poll after pressing the button. */
export const GET = withPermission('settings.write', async () => ok(await readLastBackup()))

/**
 * POST — enqueue one now. Identical to the scheduled job apart from `trigger`, so a manual
 * run lands under its own timestamped key and cannot overwrite the night's dump.
 */
export const POST = withPermission('settings.write', async (_request, _ctx, user) => {
  let jobId: string
  let kind: string
  try {
    const queue = await getQueue()
    kind = queue.kind
    jobId = await queue.add('db.backup', { trigger: 'manual', actorId: user.id })
  } catch (err) {
    return fail(503, 'queue_unavailable', err instanceof Error ? err.message : 'queue unavailable')
  }
  await audit({
    actorId: user.id,
    action: 'backup.run',
    targetType: 'settings',
    after: { jobId, trigger: 'manual' },
  })
  return ok({ jobId, queue: kind }, { status: 202 })
})
