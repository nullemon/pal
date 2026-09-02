import { fileURLToPath } from 'node:url'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { createDb, type DbHandle, type Schema } from './client.js'

/** Absolute path of the committed migrations folder (works from src/ and dist/). */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

/** Apply pending migrations using the migrator that matches the handle's driver. */
export const runMigrations = async (handle: DbHandle): Promise<void> => {
  if (handle.kind === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    await migrate(handle.raw as PgliteDatabase<Schema>, { migrationsFolder })
  } else {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator')
    await migrate(handle.raw as PostgresJsDatabase<Schema>, { migrationsFolder })
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href

if (isMain) {
  const handle = await createDb()
  console.log(`[db] migrating ${handle.kind} (${handle.url.replace(/:\/\/.*@/, '://***@')})`)
  await runMigrations(handle)
  console.log('[db] migrations applied')
  await handle.close()
}
