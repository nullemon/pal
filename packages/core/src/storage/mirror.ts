import {
  backupKey,
  isMirroredKey,
  MIRRORED_PREFIXES,
  profileForKey,
  type RoutableProfile,
} from './profiles.js'
import type { StorageRouter } from './router.js'

/**
 * The object mirror (docs/08 "The mirror").
 *
 * R2 has no object versioning — `GetBucketVersioning` is on Cloudflare's unimplemented list —
 * so a deleted or corrupted image has nowhere to come back from unless something copied it
 * somewhere else first. This is that something: every durable object is written a second time
 * into a bucket with different credentials and, ideally, a different account.
 *
 * Two paths feed it, and both are needed:
 *
 * - **At write time.** The router calls `onWrite` after each successful `put`, which covers
 *   everything the app and worker produce: page variants, covers, banners, avatars.
 * - **The reconcile sweep.** Uploads from the admin panel go from the *browser* straight to a
 *   presigned URL, so the raw originals under `uploads/` never pass through a `put` this
 *   process can see. The sweep is what catches those, and it doubles as the repair path for
 *   anything a failed job dropped. It is a set difference over two listings, not a HEAD per
 *   object, so it stays cheap at fifty thousand pages.
 */

/** How many mirror jobs one sweep will enqueue before stopping. */
export const RECONCILE_DEFAULT_LIMIT = 2_000

/**
 * Ask for an object to be mirrored. Never throws and never blocks the caller: a write that
 * succeeded must not be reported as failed because the queue was briefly unreachable — the
 * sweep will find it.
 */
export const enqueueMirror = (profile: RoutableProfile, key: string): void => {
  void (async () => {
    try {
      const { getQueue } = await import('../queue/index.js')
      const queue = await getQueue()
      // Same object, same job: a re-upload of identical bytes need not queue twice.
      await queue.add(
        'object.mirror',
        { profile, key },
        { jobId: `object.mirror:${profile}:${key}` },
      )
    } catch {
      // ignore: the reconcile sweep is the backstop for exactly this
    }
  })()
}

export interface MirrorResult {
  /** False when the object was gone before the job ran — deleted, or never stored. */
  copied: boolean
  bytes: number
}

/**
 * Copy one object into the mirror, then prove it arrived.
 *
 * The size check is the point. A truncated or empty copy is indistinguishable from a good one
 * until the day you need it, and that is the day you find out — so the job verifies now and
 * throws if it disagrees, which puts it back on the queue instead of into a false sense of
 * having a backup.
 */
export const mirrorOne = async (
  router: StorageRouter,
  profile: RoutableProfile,
  key: string,
): Promise<MirrorResult> => {
  const backup = router.target('backup')
  if (!backup) throw new Error('No image backup bucket is configured')
  if (!isMirroredKey(key)) return { copied: false, bytes: 0 }

  const source = router.target(profile)
  if (!source) throw new Error(`No ${profile} bucket is configured`)
  const bytes = await source.get(key)
  // Not an error: the sweep lists and the job runs later, so an object deleted in between is
  // an ordinary race, and retrying would never make it reappear.
  if (!bytes) return { copied: false, bytes: 0 }

  const target = backupKey(profile, key)
  await backup.put(target, bytes, { cacheControl: 'private, max-age=0, no-store' })
  const stored = await backup.head(target)
  if (!stored || stored.size !== bytes.byteLength) {
    throw new Error(
      `Mirror of ${key} verified wrong: wrote ${bytes.byteLength} bytes, found ${stored?.size ?? 'nothing'}`,
    )
  }
  return { copied: true, bytes: bytes.byteLength }
}

export interface ReconcileReport {
  /** Objects present in the primary buckets. */
  total: number
  /** Of those, how many the mirror already holds. */
  mirrored: number
  /** How many mirror jobs this sweep enqueued (bounded by `limit`). */
  enqueued: number
  /** True when the backlog was larger than `limit` and the next sweep has more to do. */
  truncated: boolean
}

/**
 * Diff the primary buckets against the mirror and enqueue what is missing.
 *
 * Bounded on purpose: the first sweep of an existing site has every object to do, and a queue
 * flooded with fifty thousand jobs starves everything else the worker owes readers. It stops
 * at `limit` and reports that it did, so the next run continues.
 */
export const reconcileMirror = async (
  router: StorageRouter,
  opts: { limit?: number; enqueue?: (profile: RoutableProfile, key: string) => void } = {},
): Promise<ReconcileReport> => {
  const backup = router.target('backup')
  if (!backup) throw new Error('No image backup bucket is configured')
  const limit = opts.limit ?? RECONCILE_DEFAULT_LIMIT
  const enqueue = opts.enqueue ?? enqueueMirror

  const report: ReconcileReport = { total: 0, mirrored: 0, enqueued: 0, truncated: false }
  for (const { profile, prefix } of MIRRORED_PREFIXES) {
    const source = router.target(profile)
    if (!source) continue
    const [live, copies] = await Promise.all([
      source.list(prefix),
      backup.list(backupKey(profile, prefix)),
    ])
    // Back to primary keys, so the two sides are comparable.
    const held = new Set(copies.map((k) => k.slice(`${profile}/`.length)))
    for (const key of live) {
      if (!isMirroredKey(key)) continue
      report.total += 1
      if (held.has(key)) {
        report.mirrored += 1
        continue
      }
      if (report.enqueued >= limit) {
        report.truncated = true
        continue
      }
      enqueue(profile, key)
      report.enqueued += 1
    }
  }
  return report
}

/**
 * Put an object back from the mirror.
 *
 * Used for the two cases the mirror exists for: an object that is gone, and one whose stored
 * size no longer matches the copy. `force` restores regardless, for when the bytes are
 * present and the wrong ones.
 */
export const restoreFromBackup = async (
  router: StorageRouter,
  key: string,
  opts: { force?: boolean } = {},
): Promise<{ restored: boolean; reason: 'missing' | 'size-mismatch' | 'forced' | 'intact' }> => {
  const backup = router.target('backup')
  if (!backup) throw new Error('No image backup bucket is configured')
  const profile = profileForKey(key)
  const target = router.target(profile)
  if (!target) throw new Error(`No ${profile} bucket is configured`)

  const [live, copy] = await Promise.all([target.head(key), backup.head(backupKey(profile, key))])
  if (!copy) throw new Error(`No mirrored copy of ${key}`)

  const reason = !live
    ? ('missing' as const)
    : live.size !== copy.size
      ? ('size-mismatch' as const)
      : opts.force
        ? ('forced' as const)
        : ('intact' as const)
  if (reason === 'intact') return { restored: false, reason }

  const bytes = await backup.get(backupKey(profile, key))
  if (!bytes) throw new Error(`Mirrored copy of ${key} disappeared mid-restore`)
  await target.put(key, bytes)
  return { restored: true, reason }
}
