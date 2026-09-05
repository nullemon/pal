import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Db } from '@palscans/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertPrivateDestination,
  type BackupDestination,
  type BackupEnv,
  type BackupRun,
  backupEnv,
  backupKeyFor,
  type CommandRunner,
  countTocEntries,
  parsePostgresUrl,
  prunable,
  resetBackupEnv,
  resolveDestination,
  runBackup,
} from './backup.js'

/**
 * The parts of `db.backup` worth testing without a Postgres server: the URL split that keeps
 * the password out of argv, the retention arithmetic, the "never the public bucket" guard,
 * and the run's own contract — it must always leave a `backup.last` record behind, and it
 * must not upload a dump it could not read back.
 */

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'backup-test-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  resetBackupEnv()
})

/** `runBackup` only uses the db through the injected `record`, so this never runs a query. */
const noDb = {} as Db

const destinationFor = (state: {
  put: Array<{ key: string; bytes: number }>
  deleted: string[]
  keys: string[]
}): BackupDestination => ({
  kind: 's3',
  describe: 's3://palscans-backups',
  bucket: 'palscans-backups',
  storage: async () =>
    ({
      driver: 's3' as const,
      put: async (key: string, body: Uint8Array | string) => {
        state.put.push({ key, bytes: typeof body === 'string' ? body.length : body.byteLength })
      },
      list: async () => state.keys,
      delete: async (key: string) => {
        state.deleted.push(key)
      },
      // The job touches nothing else on the Storage interface.
    }) as unknown as Awaited<ReturnType<BackupDestination['storage']>>,
})

describe('parsePostgresUrl', () => {
  it('splits the URL and keeps the password out of the returned flags', () => {
    const conn = parsePostgresUrl(
      'postgres://pal:s3cr%40t@db.internal:5433/palscans?sslmode=require',
    )
    expect(conn).toEqual({
      host: 'db.internal',
      port: '5433',
      user: 'pal',
      password: 's3cr@t',
      database: 'palscans',
      sslmode: 'require',
    })
  })

  it('refuses pglite, which has no server to dump', () => {
    expect(() => parsePostgresUrl('pglite://./.data/pg')).toThrow(/pglite/)
  })

  it('refuses a URL with no database name', () => {
    expect(() => parsePostgresUrl('postgres://pal:pal@localhost:5432/')).toThrow(/database name/)
  })
})

describe('backupKeyFor', () => {
  const now = new Date('2026-09-05T14:32:07Z')

  it('names the scheduled dump by date, so a day has one', () => {
    expect(backupKeyFor('pg', 'schedule', now)).toBe('pg/palscans-2026-09-05.dump')
  })

  it('timestamps a manual dump so Backup now cannot overwrite the nightly one', () => {
    expect(backupKeyFor('pg', 'manual', now)).toBe('pg/palscans-2026-09-05T1432Z.dump')
  })

  it('normalises a prefix with slashes', () => {
    expect(backupKeyFor('/pg/', 'schedule', now)).toBe('pg/palscans-2026-09-05.dump')
  })
})

describe('prunable', () => {
  const keys = [
    'pg/palscans-2026-08-01.dump',
    'pg/palscans-2026-08-29.dump',
    'pg/palscans-2026-09-05.dump',
    'pg/palscans-2026-09-05T1432Z.dump',
    'pg/notes.txt',
  ]

  it('drops only dumps older than the window', () => {
    expect(prunable(keys, { today: '2026-09-05', keepDays: 14 })).toEqual([
      'pg/palscans-2026-08-01.dump',
    ])
  })

  it('leaves anything that is not a dump filename alone', () => {
    expect(prunable(keys, { today: '2026-09-05', keepDays: 0 })).not.toContain('pg/notes.txt')
  })

  it('never deletes the dump just written', () => {
    const out = prunable(keys, {
      today: '2026-09-05',
      keepDays: 0,
      keep: 'pg/palscans-2026-09-05.dump',
    })
    expect(out).not.toContain('pg/palscans-2026-09-05.dump')
    expect(out).toContain('pg/palscans-2026-08-29.dump')
  })
})

describe('the private-bucket guard', () => {
  it('refuses the bucket the CDN hostname is attached to', () => {
    expect(() => assertPrivateDestination('palscans', 'palscans')).toThrow(/public cdn/i)
    expect(() => assertPrivateDestination('PALScans', 'palscans')).toThrow(/public cdn/i)
  })

  it('allows the separate backups bucket', () => {
    expect(() => assertPrivateDestination('palscans-backups', 'palscans')).not.toThrow()
  })

  it('is off when nothing is configured, so the job records skipped instead of guessing', () => {
    resetBackupEnv()
    expect(resolveDestination({ env: envWith({}) })).toBeNull()
  })

  it('resolves BACKUP_DIR to an absolute file destination', () => {
    const dest = resolveDestination({ env: envWith({ BACKUP_DIR: dir }) })
    expect(dest?.kind).toBe('fs')
    expect(dest?.root).toBe(path.resolve(dir))
  })
})

describe('countTocEntries', () => {
  it('ignores the comment header pg_restore -l prints', () => {
    const listing = [
      ';',
      '; Archive created at 2026-09-05 14:32:07 UTC',
      ';     dbname: palscans',
      ';',
      '215; 1259 16388 TABLE public series pal',
      '216; 1259 16400 TABLE public chapters pal',
      '',
    ].join('\n')
    expect(countTocEntries(listing)).toBe(2)
  })
})

describe('runBackup', () => {
  const dumpFile = (file: string, bytes = 4096) => writeFile(file, Buffer.alloc(bytes, 7))

  /** A pg_dump/pg_restore stand-in that writes a plausible archive and lists two objects. */
  const okRunner: CommandRunner = async (file, args) => {
    if (file.endsWith('pg_dump')) {
      const out = args[args.indexOf('--file') + 1]
      if (out) await dumpFile(out)
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 0, stdout: ';\n; Archive\n1; TABLE series\n2; TABLE chapters\n', stderr: '' }
  }

  it('dumps, verifies, uploads and prunes, and records the run', async () => {
    const state = {
      put: [] as Array<{ key: string; bytes: number }>,
      deleted: [] as string[],
      keys: ['pg/palscans-2026-01-01.dump'],
    }
    const records: BackupRun[] = []
    const run = await runBackup(noDb, {
      trigger: 'manual',
      actorId: 7,
      now: new Date('2026-09-05T14:32:07Z'),
      env: envWith({}),
      databaseUrl: 'postgres://pal:pal@127.0.0.1:5432/palscans',
      run: okRunner,
      destination: destinationFor(state),
      record: async (r) => {
        records.push(r)
      },
    })

    expect(run.status).toBe('ok')
    expect(run.key).toBe('pg/palscans-2026-09-05T1432Z.dump')
    expect(run.bytes).toBe(4096)
    expect(run.entries).toBe(2)
    expect(run.actorId).toBe(7)
    expect(state.put).toEqual([{ key: 'pg/palscans-2026-09-05T1432Z.dump', bytes: 4096 }])
    expect(state.deleted).toEqual(['pg/palscans-2026-01-01.dump'])
    expect(run.pruned).toEqual(['pg/palscans-2026-01-01.dump'])
    expect(records).toHaveLength(1)
    expect(records[0]?.status).toBe('ok')
  })

  it('uploads nothing when pg_restore -l cannot read the dump', async () => {
    const state = {
      put: [] as Array<{ key: string; bytes: number }>,
      deleted: [] as string[],
      keys: [] as string[],
    }
    const records: BackupRun[] = []
    const runner: CommandRunner = async (file, args) => {
      if (file.endsWith('pg_dump')) {
        const out = args[args.indexOf('--file') + 1]
        if (out) await dumpFile(out)
        return { code: 0, stdout: '', stderr: '' }
      }
      return {
        code: 1,
        stdout: '',
        stderr: 'pg_restore: error: input file appears to be a text format dump. Please use psql.',
      }
    }
    await expect(
      runBackup(noDb, {
        env: envWith({}),
        databaseUrl: 'postgres://pal:pal@127.0.0.1:5432/palscans',
        run: runner,
        destination: destinationFor(state),
        record: async (r) => {
          records.push(r)
        },
      }),
    ).rejects.toThrow(/text format dump/)
    expect(state.put).toEqual([])
    expect(records.at(-1)?.status).toBe('failed')
    expect(records.at(-1)?.error).toMatch(/text format dump/)
  })

  it('records skipped, not failed, when no destination is configured', async () => {
    const records: BackupRun[] = []
    const run = await runBackup(noDb, {
      env: envWith({}),
      destination: null,
      record: async (r) => {
        records.push(r)
      },
    })
    expect(run.status).toBe('skipped')
    expect(run.error).toMatch(/BACKUP_S3_BUCKET/)
    expect(records).toHaveLength(1)
  })

  it('refuses to upload a dump larger than BACKUP_MAX_BYTES', async () => {
    const state = {
      put: [] as Array<{ key: string; bytes: number }>,
      deleted: [] as string[],
      keys: [] as string[],
    }
    await expect(
      runBackup(noDb, {
        env: envWith({ BACKUP_MAX_BYTES: '1024' }),
        databaseUrl: 'postgres://pal:pal@127.0.0.1:5432/palscans',
        run: okRunner,
        destination: destinationFor(state),
        record: async () => undefined,
      }),
    ).rejects.toThrow(/BACKUP_MAX_BYTES/)
    expect(state.put).toEqual([])
  })
})

/**
 * A parsed backup env built from `overrides` alone, so a stray BACKUP_* in the developer's
 * shell cannot change what a test asserts. `process.env` is restored before returning.
 */
function envWith(overrides: Record<string, string>): BackupEnv {
  const before = { ...process.env }
  for (const key of Object.keys(process.env))
    if (key.startsWith('BACKUP_') || key.startsWith('PG_') || key === 'WORKER_BACKUP_MS')
      delete process.env[key]
  Object.assign(process.env, overrides)
  resetBackupEnv()
  const env = backupEnv()
  process.env = before
  resetBackupEnv()
  return env
}
