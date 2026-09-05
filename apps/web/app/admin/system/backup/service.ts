import { getDb, getSetting } from '@palscans/db'
import { BACKUP_SETTING_KEY, type BackupRunView, isBackupRun } from './shared'

/**
 * The read side of `Admin → System → Backup` (docs/17 §G), shared by the screen and
 * `/api/admin/backup` the way `app/admin/import/run-service.ts` is (docs/17 §E).
 *
 * There is no backup table and no migration for one: the worker records each run in the
 * generic `settings` key/value table under `backup.last`. Everything here is a *report* of
 * what the worker did — the web app never dumps anything, because it has neither `pg_dump`
 * nor the private bucket's credentials, and should not.
 */

/** The last recorded run, or null when the job has never run against this database. */
export const readLastBackup = async (): Promise<BackupRunView | null> => {
  const db = await getDb()
  const row = await getSetting<unknown>(db, BACKUP_SETTING_KEY, null)
  return isBackupRun(row) ? row : null
}
