import 'server-only'
import { getQueue } from '@palscans/core/queue'
import {
  getDb,
  type ImportCounts,
  type ImportCursor,
  type ImportPhase,
  type ImportRunError,
  type ImportStatus,
  importRuns,
} from '@palscans/db'
import { desc, eq, inArray } from 'drizzle-orm'
import type { RunView } from './types'

/**
 * Server side of the import run (docs/17 §E). The web app never imports anything itself: it
 * creates the `import_runs` row, enqueues `import.run`, and afterwards only reads progress
 * and sets the two stop flags the worker checks between batches.
 */

/** Statuses that still own the importer; the database refuses a second live run. */
const LIVE: readonly ImportStatus[] = ['queued', 'running', 'paused']

const columns = {
  id: importRuns.id,
  source: importRuns.source,
  status: importRuns.status,
  phase: importRuns.phase,
  cursor: importRuns.cursor,
  counts: importRuns.counts,
  errors: importRuns.errors,
  cancelRequested: importRuns.cancelRequested,
  pauseRequested: importRuns.pauseRequested,
  startedAt: importRuns.startedAt,
  updatedAt: importRuns.updatedAt,
  heartbeatAt: importRuns.heartbeatAt,
  finishedAt: importRuns.finishedAt,
}

const toView = (row: {
  id: number
  source: string
  status: ImportStatus
  phase: ImportPhase
  cursor: ImportCursor
  counts: ImportCounts
  errors: ImportRunError[]
  cancelRequested: boolean
  pauseRequested: boolean
  startedAt: Date
  updatedAt: Date
  heartbeatAt: Date | null
  finishedAt: Date | null
}): RunView => ({
  id: row.id,
  source: row.source,
  status: row.status,
  phase: row.phase,
  counts: row.counts,
  // The row keeps up to 200; the panel shows the most recent handful.
  errors: row.errors.slice(-25),
  errorCount: row.errors.length,
  stopping: row.cancelRequested || row.pauseRequested,
  startedAt: row.startedAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  heartbeatAt: row.heartbeatAt?.toISOString() ?? null,
  finishedAt: row.finishedAt?.toISOString() ?? null,
})

/** The run that owns the importer right now, if any. */
export const liveRunView = async (): Promise<RunView | null> => {
  const db = await getDb()
  const [row] = await db
    .select(columns)
    .from(importRuns)
    .where(inArray(importRuns.status, [...LIVE]))
    .limit(1)
  return row ? toView(row) : null
}

/** The live run, or the most recent finished one so the panel still has something to show. */
export const latestRunView = async (): Promise<RunView | null> => {
  const live = await liveRunView()
  if (live) return live
  const db = await getDb()
  const [row] = await db
    .select(columns)
    .from(importRuns)
    .orderBy(desc(importRuns.startedAt))
    .limit(1)
  return row ? toView(row) : null
}

export class RunBusyError extends Error {
  constructor() {
    super('An import is already running.')
    this.name = 'RunBusyError'
  }
}

/**
 * Create the run and enqueue it. The unique live index does the mutual exclusion, so two
 * operators pressing Start at the same moment produce one run and one refusal, never two
 * importers racing over the same catalogue.
 */
export const startRun = async (
  source: string,
  config: Record<string, unknown>,
  userId: number,
): Promise<RunView> => {
  const db = await getDb()
  const inserted = await db
    .insert(importRuns)
    .values({ source, config, status: 'queued', startedBy: userId })
    .onConflictDoNothing()
    .returning(columns)
  const row = inserted[0]
  if (!row) throw new RunBusyError()
  const queue = await getQueue()
  await queue.add('import.run', { runId: row.id }, { jobId: `import.run:${row.id}`, attempts: 1 })
  return toView(row)
}

export type RunAction = 'pause' | 'resume' | 'cancel'

/**
 * Apply a stop or restart. Pause and cancel only *request* — the runner acts on them between
 * batches, which is why an import never stops with a half-written chapter. Resume re-enqueues
 * so a worker picks the run back up at its stored cursor.
 */
export const controlRun = async (id: number, action: RunAction): Promise<RunView | null> => {
  const db = await getDb()
  const now = new Date()
  const [current] = await db.select(columns).from(importRuns).where(eq(importRuns.id, id)).limit(1)
  if (!current) return null

  if (action === 'pause') {
    await db
      .update(importRuns)
      .set({ pauseRequested: true, updatedAt: now })
      .where(eq(importRuns.id, id))
  } else if (action === 'resume') {
    await db
      .update(importRuns)
      .set({ pauseRequested: false, status: 'queued', updatedAt: now })
      .where(eq(importRuns.id, id))
    const queue = await getQueue()
    await queue.add(
      'import.run',
      { runId: id },
      { jobId: `import.run:${id}:${now.getTime()}`, attempts: 1 },
    )
  } else {
    // A run no worker has claimed can be closed outright; a running one is asked to stop and
    // finishes its current batch first.
    const detached = current.status === 'queued' || current.status === 'paused'
    await db
      .update(importRuns)
      .set({
        cancelRequested: true,
        ...(detached ? { status: 'cancelled' as const, finishedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(importRuns.id, id))
  }

  const [row] = await db.select(columns).from(importRuns).where(eq(importRuns.id, id)).limit(1)
  return row ? toView(row) : null
}
