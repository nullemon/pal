import {
  type Db,
  type ImportCounts,
  type ImportCursor,
  type ImportPhase,
  type ImportRunError,
  type ImportStatus,
  importRuns,
} from '@palscans/db'
import { and, eq, inArray, sql } from 'drizzle-orm'

/** Phase order. The runner walks it once; every phase resumes on its own cursor key. */
export const PHASE_ORDER: readonly ImportPhase[] = [
  'terms',
  'users',
  'series',
  'chapters',
  'bookmarks',
  'comments',
  'redirects',
  'done',
]

/** Statuses that mean a run still owns the importer, so a second Start must be refused. */
export const LIVE_STATUSES: readonly ImportStatus[] = ['queued', 'running', 'paused']

/** The `import_runs` row as the runner and the admin screen read it. */
export interface RunRow {
  id: number
  source: string
  config: Record<string, unknown>
  status: ImportStatus
  phase: ImportPhase
  cursor: ImportCursor
  counts: ImportCounts
  errors: ImportRunError[]
  cancelRequested: boolean
  pauseRequested: boolean
  startedAt: Date
  finishedAt: Date | null
}

const columns = {
  id: importRuns.id,
  source: importRuns.source,
  config: importRuns.config,
  status: importRuns.status,
  phase: importRuns.phase,
  cursor: importRuns.cursor,
  counts: importRuns.counts,
  errors: importRuns.errors,
  cancelRequested: importRuns.cancelRequested,
  pauseRequested: importRuns.pauseRequested,
  startedAt: importRuns.startedAt,
  finishedAt: importRuns.finishedAt,
}

export const loadRun = async (db: Db, id: number): Promise<RunRow | null> => {
  const [row] = await db.select(columns).from(importRuns).where(eq(importRuns.id, id)).limit(1)
  return row ?? null
}

/** The run that currently owns the importer, if any. */
export const liveRun = async (db: Db): Promise<RunRow | null> => {
  const [row] = await db
    .select(columns)
    .from(importRuns)
    .where(inArray(importRuns.status, [...LIVE_STATUSES]))
    .limit(1)
  return row ?? null
}

/** Errors kept on the row; the rest are counted but dropped so one bad table cannot bloat it. */
export const MAX_STORED_ERRORS = 200

export const addError = (
  errors: readonly ImportRunError[],
  scope: string,
  message: unknown,
  at: string,
): ImportRunError[] => {
  const text = (message instanceof Error ? message.message : String(message)).slice(0, 300)
  return errors.length >= MAX_STORED_ERRORS
    ? [...errors]
    : [...errors, { at, scope, message: text }]
}

export const bump = (counts: ImportCounts, key: keyof ImportCounts, by = 1): ImportCounts =>
  by === 0 ? counts : { ...counts, [key]: (counts[key] ?? 0) + by }

/**
 * Write one batch's checkpoint. Called inside the same transaction as the batch's writes, so
 * the cursor can never run ahead of the rows it claims to have imported — that is what makes
 * a killed worker resume correctly rather than skipping or duplicating a batch.
 */
export const checkpoint = async (
  tx: Db,
  id: number,
  patch: {
    phase?: ImportPhase
    cursor?: ImportCursor
    counts?: ImportCounts
    errors?: ImportRunError[]
    status?: ImportStatus
    finished?: boolean
  },
  now: Date,
): Promise<void> => {
  await tx
    .update(importRuns)
    .set({
      ...(patch.phase === undefined ? {} : { phase: patch.phase }),
      ...(patch.cursor === undefined ? {} : { cursor: patch.cursor }),
      ...(patch.counts === undefined ? {} : { counts: patch.counts }),
      ...(patch.errors === undefined ? {} : { errors: patch.errors }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.finished ? { finishedAt: now } : {}),
      heartbeatAt: now,
      updatedAt: now,
    })
    .where(eq(importRuns.id, id))
}

/** Read just the two stop flags — cheap enough to check between every batch. */
export const stopRequested = async (db: Db, id: number): Promise<'cancel' | 'pause' | null> => {
  const [row] = await db
    .select({ cancel: importRuns.cancelRequested, pause: importRuns.pauseRequested })
    .from(importRuns)
    .where(eq(importRuns.id, id))
    .limit(1)
  if (!row) return 'cancel'
  return row.cancel ? 'cancel' : row.pause ? 'pause' : null
}

/**
 * Claim a queued or paused run for this worker. Returns false when another worker got there
 * first, which is how two workers sharing one Redis never run the same import twice.
 */
export const claimRun = async (db: Db, id: number, now: Date): Promise<boolean> => {
  const claimed = await db
    .update(importRuns)
    .set({ status: 'running', pauseRequested: false, heartbeatAt: now, updatedAt: now })
    .where(
      and(
        eq(importRuns.id, id),
        inArray(importRuns.status, ['queued', 'paused']),
        sql`${importRuns.cancelRequested} = false`,
      ),
    )
    .returning({ id: importRuns.id })
  return claimed.length > 0
}
