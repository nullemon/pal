import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getEnv } from '@palscans/core/env'
import { type CreateStorageOptions, createStorage, type Storage } from '@palscans/core/storage'
import { type Db, settings } from '@palscans/db'
import { z } from 'zod'
import { log } from '../lib/log.js'

/**
 * `db.backup` (docs/17 §G, docs/18 §9): the nightly database dump, as a worker job rather
 * than a shell script on the host — so `Admin → System → Backup` can run it, and so the
 * outcome of the last run is a thing the panel can show instead of a log file nobody reads.
 *
 * It is deliberately the *same* three steps as the cron script in docs/18 §9, because the
 * restore procedure in `infra/RUNBOOK.md` depends on all three:
 *
 *   1. `pg_dump --format=custom --compress=9` — `pg_restore` cannot read a plain SQL dump,
 *      and no restore flag fixes the wrong format.
 *   2. `pg_restore -l` on the result — the cheapest proof that what was written is a
 *      readable archive and not 0 bytes of nothing, or a text dump.
 *   3. upload to the **private** backups bucket — never the app bucket, which has the public
 *      `cdn.` hostname attached and would put every user row and the sealed
 *      `app_credentials` table one WAF-rule mistake from being downloadable. The guard for
 *      that is `assertPrivateDestination()` below, and it fails the job rather than warning.
 *
 * Then it prunes dumps older than the retention window, and records the run in the generic
 * `settings` table under `backup.last` (no migration: docs/17 §G asks for a control and a
 * last-run outcome, not a history table).
 *
 * **The image needs `postgresql-client`.** `node:22-alpine` has no `pg_dump`, so
 * `infra/Dockerfile`'s worker stage installs it. Without it every run fails at step 1 with
 * `pg_dump not found`, which is exactly what the panel then shows.
 */

/** Where a run came from. Manual runs get a timestamped key so they cannot overwrite the daily one. */
export type BackupTrigger = 'schedule' | 'manual'

export interface BackupDestination {
  kind: 'fs' | 's3'
  /** Human-readable target, safe to show in the panel and to log — never carries a secret. */
  describe: string
  bucket?: string
  root?: string
  storage: () => Promise<Storage>
}

export interface BackupRun {
  status: 'ok' | 'failed' | 'skipped'
  trigger: BackupTrigger
  startedAt: string
  finishedAt: string
  durationMs: number
  /** The object key that was written, when one was. */
  key: string | null
  bytes: number | null
  /** Table-of-contents entries `pg_restore -l` reported. Zero would mean an empty archive. */
  entries: number | null
  destination: string | null
  pruned: string[]
  /** Who pressed the button, for a manual run. */
  actorId: number | null
  error: string | null
}

/** The `settings` key the run outcome is recorded under. Read by Admin → System → Backup. */
export const BACKUP_SETTING_KEY = 'backup.last'

/**
 * Backup configuration is read here rather than added to `@palscans/core`'s env schema on
 * purpose: it carries the credentials for a second bucket, and `apps/web` has no business
 * resolving those. The worker is the only process that runs a dump.
 */
const backupEnvSchema = z.object({
  /** How often the scheduler enqueues `db.backup`. Mirrors WORKER_ROLLUP_MS. */
  WORKER_BACKUP_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60 * 1000),
  /** Key prefix inside the destination. The runbook restores from `pg/`. */
  BACKUP_PREFIX: z.string().default('pg'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  /**
   * The dump is read into memory to be uploaded (the Storage interface takes bytes, not a
   * stream), so a very large database must not be allowed to take the worker down with it.
   * Above this the run fails and names the cron + rclone script in docs/18 §9 instead.
   */
  BACKUP_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024 * 1024),
  /** Write dumps to a local directory instead of a bucket (a mounted volume, or dev). */
  BACKUP_DIR: z.string().optional(),
  /** The private backups bucket from docs/18 §2. Never the app's bucket. */
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_ENDPOINT: z.string().optional(),
  BACKUP_S3_REGION: z.string().optional(),
  BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
  BACKUP_S3_FORCE_PATH_STYLE: z.stringbool().optional(),
  /** Overrides for a non-standard client install. */
  PG_DUMP: z.string().default('pg_dump'),
  PG_RESTORE: z.string().default('pg_restore'),
})

export type BackupEnv = z.infer<typeof backupEnvSchema>

let cachedEnv: BackupEnv | undefined

export const backupEnv = (): BackupEnv => {
  cachedEnv ??= backupEnvSchema.parse(process.env)
  return cachedEnv
}

/** Tests that mutate `process.env`. */
export const resetBackupEnv = (): void => {
  cachedEnv = undefined
}

export interface PgConnection {
  host: string
  port: string
  user: string
  password: string
  database: string
  sslmode?: string
}

/**
 * Split `DATABASE_URL` into the pieces `pg_dump` wants as flags, keeping the password in the
 * environment (`PGPASSWORD`) rather than in argv — `ps` is readable by anything on the host.
 */
export const parsePostgresUrl = (url: string): PgConnection => {
  if (url.startsWith('pglite://'))
    throw new Error('DATABASE_URL is pglite:// — there is no server to dump. Point it at Postgres.')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('DATABASE_URL is not a URL')
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol))
    throw new Error(`unsupported DATABASE_URL: ${parsed.protocol}`)
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!database) throw new Error('DATABASE_URL has no database name')
  const sslmode = parsed.searchParams.get('sslmode') ?? undefined
  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username) || 'postgres',
    password: decodeURIComponent(parsed.password),
    database,
    ...(sslmode ? { sslmode } : {}),
  }
}

/** `2026-09-05` for a scheduled run; `2026-09-05T1432Z` for one somebody pressed. */
export const backupKeyFor = (
  prefix: string,
  trigger: BackupTrigger,
  now: Date = new Date(),
): string => {
  const iso = now.toISOString()
  const stamp = trigger === 'manual' ? `${iso.slice(0, 13)}${iso.slice(14, 16)}Z` : iso.slice(0, 10)
  return `${prefix.replace(/^\/+|\/+$/g, '')}/palscans-${stamp}.dump`
}

const DUMP_KEY = /palscans-(\d{4}-\d{2}-\d{2})(T\d{4}Z)?\.dump$/

/**
 * Which keys the retention sweep deletes: dumps whose date is more than `keepDays` before
 * today. Anything that is not a dump filename is left alone, and `keep` (the key just
 * written) never goes — a clock skew must not be able to delete the backup we just made.
 */
export const prunable = (
  keys: readonly string[],
  opts: { today: string; keepDays: number; keep?: string },
): string[] => {
  const cutoff = new Date(`${opts.today}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - opts.keepDays)
  const oldest = cutoff.toISOString().slice(0, 10)
  return keys
    .filter((key) => key !== opts.keep)
    .filter((key) => {
      const m = DUMP_KEY.exec(key)
      return m?.[1] !== undefined && m[1] < oldest
    })
    .sort()
}

export interface ResolveDestinationOptions {
  env?: BackupEnv
  /**
   * The bucket the *app* serves images from, resolved from the panel credentials. The
   * backup must never land there — see the guard below.
   */
  appBucket?: string | undefined
}

/**
 * The one rule that matters: the dump must not go into the bucket with the public CDN
 * hostname attached (docs/18 §2 "Backups do not go in this bucket"). R2 has no per-prefix
 * ACL, so "same bucket" means "downloadable by anyone who can guess the key".
 */
export const assertPrivateDestination = (bucket: string, appBucket?: string): void => {
  const app = (appBucket ?? '').trim()
  if (app && bucket.trim().toLowerCase() === app.toLowerCase())
    throw new Error(
      `BACKUP_S3_BUCKET is the app's own bucket (${bucket}). That bucket has the public cdn. hostname attached — put dumps in the separate private bucket from docs/18 §2.`,
    )
}

/**
 * Where this run writes. `BACKUP_S3_BUCKET` wins; `BACKUP_DIR` is the self-hosted / mounted
 * volume path; neither set means the feature is off and the job records `skipped` rather
 * than inventing a destination.
 */
export const resolveDestination = (
  opts: ResolveDestinationOptions = {},
): BackupDestination | null => {
  const env = opts.env ?? backupEnv()
  const bucket = env.BACKUP_S3_BUCKET?.trim()
  if (bucket) {
    assertPrivateDestination(bucket, opts.appBucket)
    const app = getEnv()
    const s3: CreateStorageOptions['s3'] = {
      bucket,
      endpoint: env.BACKUP_S3_ENDPOINT ?? app.S3_ENDPOINT,
      region: env.BACKUP_S3_REGION ?? app.S3_REGION ?? 'auto',
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID ?? app.S3_ACCESS_KEY_ID,
      secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY ?? app.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE ?? app.S3_FORCE_PATH_STYLE ?? false,
      // The S3 driver insists on a public base URL because every other caller turns keys
      // into CDN links. This bucket has no public hostname and never will: nothing here
      // calls getUrl(), so the value only has to be non-empty, and this one is a statement
      // of intent rather than a URL anybody could follow.
      publicUrl: `s3://${bucket}`,
    }
    return {
      kind: 's3',
      describe: `s3://${bucket}`,
      bucket,
      storage: () => createStorage({ driver: 's3', s3 }),
    }
  }
  const dir = env.BACKUP_DIR?.trim()
  if (dir) {
    const root = path.resolve(dir)
    return {
      kind: 'fs',
      describe: `file://${root}`,
      root,
      storage: async () => {
        await mkdir(root, { recursive: true })
        return createStorage({ driver: 'fs', fs: { root, publicUrl: `file://${root}` } })
      },
    }
  }
  return null
}

export interface RunCommandResult {
  code: number
  stdout: string
  stderr: string
}

export type CommandRunner = (
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<RunCommandResult>

const runCommand: CommandRunner = (file, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    // pg_restore -l on a large archive prints one line per table; cap what is kept so a
    // pathological archive cannot grow the worker's heap.
    child.stdout.on('data', (c: Buffer) => {
      if (stdout.length < 4_000_000) stdout += c.toString()
    })
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 64_000) stderr += c.toString()
    })
    child.on('error', (err) =>
      reject(
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error(
              `${file} not found. The worker image needs postgresql-client (infra/Dockerfile) — see infra/RUNBOOK.md "Database backups".`,
            )
          : err,
      ),
    )
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })

/** Non-comment lines in a `pg_restore -l` listing: one per restorable object. */
export const countTocEntries = (listing: string): number =>
  listing.split('\n').filter((line) => line.trim() && !line.trimStart().startsWith(';')).length

export interface RunBackupOptions {
  trigger?: BackupTrigger
  actorId?: number | null
  now?: Date
  env?: BackupEnv
  databaseUrl?: string
  appBucket?: string
  /** Injected in tests; production spawns pg_dump / pg_restore. */
  run?: CommandRunner
  /** Injected in tests so nothing has to reach a bucket. */
  destination?: BackupDestination | null
  /** Injected in tests; production writes the `settings` row. */
  record?: (run: BackupRun) => Promise<void>
}

const recordRun = async (db: Db, run: BackupRun): Promise<void> => {
  const now = new Date()
  await db
    .insert(settings)
    .values({ key: BACKUP_SETTING_KEY, value: run, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: run, updatedAt: now } })
}

/**
 * Dump, verify, upload, prune — and always leave a `backup.last` row behind, whether it
 * worked or not. Operational failures are recorded and then rethrown, so the run also shows
 * up as a failed job in Admin → Jobs rather than only in a settings row.
 */
export const runBackup = async (db: Db, opts: RunBackupOptions = {}): Promise<BackupRun> => {
  const env = opts.env ?? backupEnv()
  const now = opts.now ?? new Date()
  const trigger = opts.trigger ?? 'schedule'
  const started = Date.now()
  const record = opts.record ?? ((run: BackupRun) => recordRun(db, run))
  const base: BackupRun = {
    status: 'ok',
    trigger,
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    durationMs: 0,
    key: null,
    bytes: null,
    entries: null,
    destination: null,
    pruned: [],
    actorId: opts.actorId ?? null,
    error: null,
  }
  const finish = async (patch: Partial<BackupRun>): Promise<BackupRun> => {
    const run: BackupRun = {
      ...base,
      ...patch,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    }
    await record(run).catch((err) => log.error('could not record the backup run', err))
    return run
  }

  let destination: BackupDestination | null
  try {
    destination =
      opts.destination !== undefined
        ? opts.destination
        : resolveDestination({ env, appBucket: opts.appBucket })
  } catch (err) {
    await finish({ status: 'failed', error: message(err) })
    throw err
  }
  if (!destination) {
    log.warn('db.backup skipped: no destination configured (BACKUP_S3_BUCKET or BACKUP_DIR)')
    return finish({
      status: 'skipped',
      error:
        'No backup destination configured. Set BACKUP_S3_BUCKET (the private bucket from docs/18 §2) or BACKUP_DIR.',
    })
  }

  const key = backupKeyFor(env.BACKUP_PREFIX, trigger, now)
  const dir = await mkdtemp(path.join(tmpdir(), 'palscans-backup-'))
  const file = path.join(dir, path.basename(key))
  try {
    const conn = parsePostgresUrl(opts.databaseUrl ?? getEnv().DATABASE_URL)
    const run = opts.run ?? runCommand
    const pgEnv: NodeJS.ProcessEnv = {
      PGPASSWORD: conn.password,
      ...(conn.sslmode ? { PGSSLMODE: conn.sslmode } : {}),
    }
    const connArgs = ['-h', conn.host, '-p', conn.port, '-U', conn.user, '--no-password']

    // 1 · the dump. --format=custom is what makes the runbook's pg_restore work at all.
    const dump = await run(
      env.PG_DUMP,
      [...connArgs, '-d', conn.database, '--format=custom', '--compress=9', '--file', file],
      pgEnv,
    )
    if (dump.code !== 0) throw new Error(`pg_dump exited ${dump.code}: ${tail(dump.stderr)}`)

    const bytes = (await stat(file)).size
    if (bytes === 0) throw new Error('pg_dump wrote an empty file')

    // 2 · verify. A plain-SQL dump, a truncated file or an empty archive all fail here,
    // before anything is uploaded and long before somebody needs it at 3am.
    const listed = await run(env.PG_RESTORE, ['-l', file], pgEnv)
    if (listed.code !== 0)
      throw new Error(
        `pg_restore -l rejected the dump (exit ${listed.code}): ${tail(listed.stderr)}`,
      )
    const entries = countTocEntries(listed.stdout)
    if (entries === 0) throw new Error('pg_restore -l listed no objects — the archive is empty')

    // 3 · upload, to the private bucket.
    if (bytes > env.BACKUP_MAX_BYTES)
      throw new Error(
        `dump is ${bytes} bytes, over BACKUP_MAX_BYTES (${env.BACKUP_MAX_BYTES}). The job uploads in one piece; for a database this size use the host cron + rclone script in docs/18 §9.`,
      )
    const storage = await destination.storage()
    await storage.put(key, await readFile(file), {
      contentType: 'application/octet-stream',
      cacheControl: 'private, no-store',
    })

    // 4 · retention.
    const prefix = `${env.BACKUP_PREFIX.replace(/^\/+|\/+$/g, '')}/`
    const existing = await storage.list(prefix).catch((err) => {
      log.warn('backup retention sweep could not list the destination', { error: message(err) })
      return [] as string[]
    })
    const stale = prunable(existing, {
      today: now.toISOString().slice(0, 10),
      keepDays: env.BACKUP_RETENTION_DAYS,
      keep: key,
    })
    const pruned: string[] = []
    for (const old of stale) {
      try {
        await storage.delete(old)
        pruned.push(old)
      } catch (err) {
        log.warn('could not prune an old dump', { key: old, error: message(err) })
      }
    }

    log.info('db.backup ok', {
      key,
      bytes,
      entries,
      destination: destination.describe,
      pruned: pruned.length,
    })
    return finish({
      status: 'ok',
      key,
      bytes,
      entries,
      destination: destination.describe,
      pruned,
    })
  } catch (err) {
    log.error('db.backup failed', err)
    await finish({
      status: 'failed',
      key,
      destination: destination.describe,
      error: message(err),
    })
    throw err
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Last few lines of a child process's stderr, bounded so a settings row stays small. */
const tail = (text: string, lines = 4): string =>
  text.trim().split('\n').slice(-lines).join(' · ').slice(0, 500)
