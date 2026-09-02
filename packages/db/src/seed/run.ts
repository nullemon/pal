import { createDb } from '../client.js'
import { runMigrations } from '../migrate.js'
import { seed } from './index.js'

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
