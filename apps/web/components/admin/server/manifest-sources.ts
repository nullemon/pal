import 'server-only'
import { getQueue } from '@palscans/core/queue'
import { type Db, getDb, manifestSources } from '@palscans/db'
import { and, desc, eq } from 'drizzle-orm'

/**
 * The manifest links a series follows (docs/03 "Keeping a manifest in sync").
 *
 * The admin half: create, pause, forget, and ask for a check now. The checking itself is the
 * worker's — `apps/worker/src/jobs/manifest-sync.ts` — because it has the clock and because
 * importing forty chapters inside a request is not a request.
 */

export interface ManifestSourceRow {
  id: number
  seriesId: number
  url: string
  language: string
  store: 'remote' | 'storage'
  publishMode: 'ready' | 'publish'
  isPremium: boolean
  groupName: string | null
  active: boolean
  lastCheckedAt: string | null
  lastChangedAt: string | null
  lastError: string | null
  imported: number
}

const toRow = (r: typeof manifestSources.$inferSelect): ManifestSourceRow => ({
  id: r.id,
  seriesId: r.seriesId,
  url: r.url,
  language: r.language,
  store: r.store,
  publishMode: r.publishMode,
  isPremium: r.isPremium,
  groupName: r.groupName,
  active: r.active,
  lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
  lastChangedAt: r.lastChangedAt?.toISOString() ?? null,
  lastError: r.lastError,
  imported: r.imported,
})

export const listManifestSources = async (
  seriesId: number,
  db?: Db,
): Promise<ManifestSourceRow[]> => {
  const database = db ?? (await getDb())
  const rows = await database
    .select()
    .from(manifestSources)
    .where(eq(manifestSources.seriesId, seriesId))
    .orderBy(desc(manifestSources.id))
    .limit(50)
  return rows.map(toRow)
}

export interface FollowManifestInput {
  seriesId: number
  url: string
  language: string
  store: 'remote' | 'storage'
  publishMode: 'ready' | 'publish'
  isPremium?: boolean
  groupName?: string | null
  userId: number
}

/**
 * Follow a manifest, or update the terms on which we already follow it.
 *
 * Upsert rather than insert: an operator who imports from the same file twice with the box
 * ticked means "keep following it, on these settings" both times. A second row would import
 * every new chapter twice and then collide on its number — which is what the unique index
 * prevents, but a 500 from the import panel is not the right way to find that out.
 *
 * The fingerprint is deliberately left alone on an update. It is a record of what the file
 * looked like at the last check, and the settings changing does not change that; clearing it
 * would only buy one redundant pass over the chapter table.
 */
export const followManifest = async (
  input: FollowManifestInput,
  db?: Db,
): Promise<ManifestSourceRow | null> => {
  const database = db ?? (await getDb())
  const now = new Date()
  const [row] = await database
    .insert(manifestSources)
    .values({
      seriesId: input.seriesId,
      url: input.url,
      language: input.language,
      store: input.store,
      publishMode: input.publishMode,
      isPremium: input.isPremium ?? false,
      groupName: input.groupName ?? null,
      active: true,
      createdBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [manifestSources.seriesId, manifestSources.url, manifestSources.language],
      set: {
        store: input.store,
        publishMode: input.publishMode,
        isPremium: input.isPremium ?? false,
        groupName: input.groupName ?? null,
        // Re-following a paused source resumes it: that is what ticking the box again means.
        active: true,
        updatedAt: now,
      },
    })
    .returning()
  return row ? toRow(row) : null
}

/** Pause or resume. Paused rather than deleted keeps the history and the settings. */
export const setManifestSourceActive = async (
  id: number,
  active: boolean,
  db?: Db,
): Promise<ManifestSourceRow | null> => {
  const database = db ?? (await getDb())
  const [row] = await database
    .update(manifestSources)
    .set({ active, updatedAt: new Date() })
    .where(eq(manifestSources.id, id))
    .returning()
  return row ? toRow(row) : null
}

/** Stop following entirely. The chapters it imported stay — they are ours now. */
export const forgetManifestSource = async (
  id: number,
  seriesId: number,
  db?: Db,
): Promise<boolean> => {
  const database = db ?? (await getDb())
  const rows = await database
    .delete(manifestSources)
    .where(and(eq(manifestSources.id, id), eq(manifestSources.seriesId, seriesId)))
    .returning({ id: manifestSources.id })
  return rows.length > 0
}

/**
 * Ask the worker to check this source now.
 *
 * `jobId` collapses a double-click and nothing more.
 *
 * It used to be `manifest.sync:source:<id>` with no time in it, which reads as "one check
 * per source" and behaves as "one check per source, ever": BullMQ ignores an `add` whose
 * id exists, and completed jobs are retained (`removeOnComplete: 1000`). So the button
 * worked once and was then silently inert until a thousand other jobs had evicted it --
 * the operator presses it, the panel says it was queued, and nothing happens.
 *
 * Ten seconds is long enough to swallow an impatient second click and short enough that
 * "try again" means what it says.
 *
 * Returns false when there is no queue to ask — the panel says "it will be picked up on the
 * next pass", which is true: the scheduler's own producer does not depend on this.
 */
export const checkManifestSourceNow = async (
  id: number,
  now: Date = new Date(),
): Promise<boolean> => {
  try {
    const queue = await getQueue()
    const window = Math.floor(now.getTime() / 10_000)
    await queue.add(
      'manifest.sync',
      { sourceId: id },
      { jobId: `manifest.sync:source:${id}:${window}` },
    )
    return true
  } catch {
    return false
  }
}
