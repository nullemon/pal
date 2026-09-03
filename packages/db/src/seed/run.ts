import { getEnv } from '@palscans/core/env'
import { createDb, DEFAULT_PGLITE_URL } from '../client.js'
import { runMigrations } from '../migrate.js'
import { seed } from './index.js'

/**
 * Seed a development database.
 *
 * The seeder creates staff accounts — including an administrator — whose password is a
 * constant in this repository. Running it against a live site would hand anyone who can read
 * the source an admin login, and overwrite real accounts on the way. Documentation saying
 * "do not run this in production" is not a control, so the two signals that this is not a
 * development box are checked here and refused.
 *
 * `SEED_FORCE=1` overrides, for the case where someone genuinely wants a seeded database on a
 * non-local host (a shared staging box, a compose stack on a laptop).
 */
const forced = process.env.SEED_FORCE === '1'

const refuse = (why: string): never => {
  console.error(
    [
      `[seed] refusing to run: ${why}`,
      '',
      'The seeder writes staff accounts whose password is hardcoded in this repository',
      '(packages/db/src/seed/index.ts). On a live site that is an admin backdoor, and it',
      'would overwrite real accounts.',
      '',
      'If you are certain this is a development database, re-run with SEED_FORCE=1.',
    ].join('\n'),
  )
  process.exit(1)
}

/** Loopback, or the embedded PGlite database — the only shapes a dev box normally has. */
const isLocalTarget = (url: string): boolean => {
  if (url.startsWith('pglite://')) return true
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === ''
  } catch {
    return false
  }
}

// Decide before anything is connected or migrated, not after.
const target = getEnv().DATABASE_URL || DEFAULT_PGLITE_URL
if (!forced) {
  if (process.env.NODE_ENV === 'production') refuse('NODE_ENV is production')
  if (!isLocalTarget(target)) refuse(`the database is not local (${new URL(target).hostname})`)
}

const handle = await createDb()
console.log(`[seed] ${handle.kind} (${handle.url.replace(/:\/\/.*@/, '://***@')})`)

if (process.env.SEED_MIGRATE !== '0') await runMigrations(handle)
const generatedCount = process.env.SEED_GENERATED
  ? Number.parseInt(process.env.SEED_GENERATED, 10)
  : undefined
const started = Date.now()
await seed(handle.db, { generatedCount, log: (m) => console.log(`[seed] ${m}`) })
console.log(`[seed] finished in ${((Date.now() - started) / 1000).toFixed(1)}s`)
await handle.close()
