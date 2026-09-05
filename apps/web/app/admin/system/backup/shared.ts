/**
 * The shape of a `db.backup` run and the two formatters the screen renders it with.
 *
 * Kept apart from `service.ts` on purpose: `service.ts` imports `@palscans/db`, and the
 * client panel needs this type and these functions. Importing them from there pulls the
 * Postgres client into the browser bundle — Turbopack says so out loud, and it is a real
 * leak, not a warning to silence.
 */

export const BACKUP_SETTING_KEY = 'backup.last'

export interface BackupRunView {
  status: 'ok' | 'failed' | 'skipped'
  trigger: 'schedule' | 'manual'
  startedAt: string
  finishedAt: string
  durationMs: number
  /** The object key written, when one was. */
  key: string | null
  bytes: number | null
  /** Table-of-contents entries `pg_restore -l` reported for the archive. */
  entries: number | null
  destination: string | null
  pruned: string[]
  actorId: number | null
  error: string | null
}

/** The settings row is `jsonb` written by another process — check it before trusting it. */
export const isBackupRun = (value: unknown): value is BackupRunView =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as BackupRunView).status === 'string' &&
  typeof (value as BackupRunView).finishedAt === 'string'

/** `537989` → `525.4 KB`. Sizes here are informational, so base 1024 with one decimal. */
export const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`
}

/** `2131` → `2.1s`. Runs are seconds-to-minutes; anything longer reads better as minutes. */
export const formatDuration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`
}
