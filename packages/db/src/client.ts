import path from 'node:path'
import { findRepoRoot, getEnv } from '@palscans/core'
import type { SQL } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

export type Schema = typeof schema
/** The database type every query helper accepts — works for postgres-js and PGlite alike. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>

export type DbKind = 'postgres' | 'pglite'

export interface DbHandle {
  db: Db
  kind: DbKind
  url: string
  /** The concrete driver database, for the migrator. */
  raw: PostgresJsDatabase<Schema> | PgliteDatabase<Schema>
  close(): Promise<void>
}

export const DEFAULT_PGLITE_URL = 'pglite://.data/pglite'

export const dbKindFor = (url: string): DbKind => {
  if (url.startsWith('pglite://')) return 'pglite'
  if (/^postgres(ql)?:\/\//.test(url)) return 'postgres'
  throw new Error(
    `DATABASE_URL must start with postgres:// or pglite:// (got ${url.slice(0, 12)}…)`,
  )
}

/** `pglite://memory` → in-memory; `pglite://.data/pglite` → folder relative to the repo root. */
export const pgliteDataDir = (url: string): string | undefined => {
  const p = url.slice('pglite://'.length)
  if (!p || p === 'memory' || p === ':memory:') return undefined
  return path.isAbsolute(p) ? p : path.join(findRepoRoot(), p)
}

/**
 * Create a database handle from a URL: postgres:// uses postgres-js, pglite:// uses PGlite
 * (loaded lazily so production bundles never carry the WASM build).
 */
export const createDb = async (
  url: string | undefined = getEnv().DATABASE_URL,
): Promise<DbHandle> => {
  const resolved = url || DEFAULT_PGLITE_URL
  const kind = dbKindFor(resolved)
  if (kind === 'postgres') {
    const client = postgres(resolved, {
      max: getEnv().DATABASE_POOL_MAX,
      prepare: false,
      onnotice: () => undefined,
    })
    const raw = drizzlePostgres(client, { schema, casing: 'snake_case' })
    return {
      db: raw as unknown as Db,
      kind,
      url: resolved,
      raw,
      close: () => client.end({ timeout: 5 }),
    }
  }
  const [{ PGlite }, { citext }, { pg_trgm }, { drizzle: drizzlePglite }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/citext'),
    import('@electric-sql/pglite/contrib/pg_trgm'),
    import('drizzle-orm/pglite'),
  ])
  const dataDir = pgliteDataDir(resolved)
  const client = dataDir
    ? new PGlite(dataDir, { extensions: { citext, pg_trgm } })
    : new PGlite({ extensions: { citext, pg_trgm } })
  await client.waitReady
  const raw = drizzlePglite(client, { schema, casing: 'snake_case' })
  return {
    db: raw as unknown as Db,
    kind,
    url: resolved,
    raw,
    close: () => client.close(),
  }
}

/**
 * Run raw SQL and get rows back regardless of driver: postgres-js returns an array,
 * PGlite returns `{ rows }`. Prefer the query builder; use this for reports and admin tools.
 */
export const executeRows = async <T extends Record<string, unknown> = Record<string, unknown>>(
  database: Db,
  query: SQL,
): Promise<T[]> => {
  const result: unknown = await database.execute(query)
  if (Array.isArray(result)) return result as T[]
  const rows = (result as { rows?: unknown }).rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

let shared: Promise<DbHandle> | undefined

/** Process-wide handle built from DATABASE_URL on first use. */
export const getDbHandle = (): Promise<DbHandle> => {
  shared ??= createDb()
  return shared
}

/** The canonical way to get a database in app code: `const db = await getDb()`. */
export const getDb = async (): Promise<Db> => (await getDbHandle()).db

export const closeDb = async (): Promise<void> => {
  if (!shared) return
  const h = await shared
  shared = undefined
  await h.close()
}

let sharedSync: DbHandle | undefined
/**
 * Synchronous convenience for postgres:// URLs (postgres-js connects lazily). With a
 * pglite:// URL, call `await getDb()` once first (e.g. in instrumentation) — until then
 * touching `db` throws a clear error rather than returning a half-built client.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    if (!sharedSync) {
      const url = getEnv().DATABASE_URL || DEFAULT_PGLITE_URL
      if (dbKindFor(url) === 'pglite') {
        throw new Error(
          'DATABASE_URL is pglite://; use `await getDb()` (or warm it up once) instead of the sync `db` export',
        )
      }
      const client = postgres(url, {
        max: getEnv().DATABASE_POOL_MAX,
        prepare: false,
        onnotice: () => undefined,
      })
      const raw = drizzlePostgres(client, { schema, casing: 'snake_case' })
      sharedSync = {
        db: raw as unknown as Db,
        kind: 'postgres',
        url,
        raw,
        close: () => client.end({ timeout: 5 }),
      }
      shared ??= Promise.resolve(sharedSync)
    }
    const value = Reflect.get(sharedSync.db as object, prop, sharedSync.db)
    return typeof value === 'function' ? value.bind(sharedSync.db) : value
  },
})

export { schema }
