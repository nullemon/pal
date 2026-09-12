import {
  getStorage,
  mirrorOne,
  type ReconcileReport,
  type RoutableProfile,
  reconcileMirror,
} from '@palscans/core/storage'
import { z } from 'zod'
import { log } from '../lib/log.js'

/**
 * The object mirror's worker side (docs/08 "The mirror"). The logic lives in
 * `@palscans/core/storage` so it can be tested against in-memory buckets; this is the part
 * that holds the storage handle, the schedule and the logging.
 */

const env = () =>
  z
    .object({
      /**
       * How often the reconcile sweep runs. Hourly by default: it is two bucket listings and
       * a set difference, and its whole job is to notice objects the write-time hook could
       * not see — originals the browser uploaded straight to a presigned URL.
       */
      WORKER_MIRROR_MS: z.coerce.number().int().positive().default(3_600_000),
      /** Most objects one sweep will queue, so a first run cannot starve reader-facing jobs. */
      WORKER_MIRROR_BATCH: z.coerce.number().int().positive().default(2_000),
    })
    .parse(process.env)

export const mirrorEnv = env

/**
 * Copy one object into the backup bucket, verifying the copy actually landed.
 *
 * Deliberately silent on success: a release day mirrors thousands of objects and a line each
 * would bury everything else in the log. A failure throws, which BullMQ logs and retries, and
 * the sweep below reports the backlog in one line rather than ten thousand.
 */
export const runObjectMirror = async (profile: RoutableProfile, key: string): Promise<void> => {
  const storage = await getStorage()
  if (!storage.hasBackup) return
  await mirrorOne(storage, profile, key)
}

/**
 * Diff the primary buckets against the mirror and queue whatever is missing.
 *
 * Logged only when there is a backlog: "the mirror is up to date" every hour is noise, while
 * "1,400 objects are not backed up" is the single most useful line this worker can print.
 */
export const runObjectReconcile = async (limit?: number): Promise<ReconcileReport | null> => {
  const storage = await getStorage()
  if (!storage.hasBackup) return null
  const report = await reconcileMirror(storage, { limit: limit ?? env().WORKER_MIRROR_BATCH })
  if (report.enqueued > 0) {
    log.info('object mirror is behind, queued a catch-up', {
      ...report,
      missing: report.total - report.mirrored,
    })
  }
  return report
}
