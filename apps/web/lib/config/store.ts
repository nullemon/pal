import 'server-only'
import { seal, sealingKeySource } from '@palscans/core'
import { appCredentials, getDb, readSealedCredentials } from '@palscans/db'
import { inArray } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { setConfigMirror } from './mirror'
import { CONFIG_FIELDS, type ConfigField, FIELDS_BY_ID, SECRET_MASK } from './registry'

/**
 * Reading and writing the operator's integration credentials (docs/19).
 *
 * Precedence is **panel over environment**: a value typed into the admin panel wins, and
 * clearing it falls back to whatever the deploy environment provides. That ordering is what
 * lets an existing `.env` deployment keep working untouched while values are moved into the
 * panel one at a time.
 */

export const CONFIG_CACHE_TAG = 'integrations'

/** Where a resolved value came from — surfaced in the panel so nothing is a mystery. */
export type ConfigSource = 'panel' | 'env' | 'unset'

export interface ResolvedConfig {
  values: Record<string, string>
  sources: Record<string, ConfigSource>
}

const envValue = (field: ConfigField): string => (process.env[field.env] ?? '').trim()

/** The sealed rows, decrypted. Cached and tagged; every write purges it. */
const cachedStored = unstable_cache(
  async (): Promise<Record<string, string>> => {
    try {
      // The unsealing itself lives in @palscans/db so the worker's resolver
      // (apps/worker/src/lib/config.ts) runs the same code rather than a second copy. A row
      // that will not open (the sealing key was rotated) comes back absent, so the
      // environment fallback takes over instead of the site breaking.
      return await readSealedCredentials(
        await getDb(),
        CONFIG_FIELDS.map((f) => f.id),
      )
    } catch {
      // No database yet, or it is down: the environment alone still boots the site.
      return {}
    }
  },
  ['integrations', 'stored'],
  { revalidate: 300, tags: [CONFIG_CACHE_TAG] },
)

/**
 * Every registry key resolved to its effective value, with where it came from.
 *
 * Resolving also refreshes the synchronous mirror (`./mirror`), which is why nothing has to
 * hook the root layout to keep it warm — that layout is deliberately synchronous so `/` and
 * the series pages stay prerendered, and a database read there would make every route
 * dynamic. Instead the mirror is a write-through cache of this function: any async path that
 * reads configuration keeps it current, and `instrumentation.ts` seeds it at process start.
 */
export const resolveConfig = async (): Promise<ResolvedConfig> => {
  const stored = await cachedStored()
  const values: Record<string, string> = {}
  const sources: Record<string, ConfigSource> = {}
  for (const field of CONFIG_FIELDS) {
    const fromPanel = stored[field.id] ?? ''
    const fromEnv = envValue(field)
    values[field.id] = fromPanel || fromEnv
    sources[field.id] = fromPanel ? 'panel' : fromEnv ? 'env' : 'unset'
  }
  const driver = values['storage.driver']
  setConfigMirror({
    driver: driver === 'fs' ? 'fs' : 's3',
    cdnUrl: values['storage.public_cdn_url'] ?? '',
  })
  return { values, sources }
}

/** One value, or '' when neither the panel nor the environment has it. */
export const configValue = async (id: string): Promise<string> =>
  (await resolveConfig()).values[id] ?? ''

export interface ConfigFieldView {
  id: string
  /** The value, or the mask when it is a secret that is set. Never the secret itself. */
  value: string
  source: ConfigSource
}

/** The panel's view: plain values as they are, secrets reduced to "set" or "not set". */
export const configView = async (): Promise<{
  fields: ConfigFieldView[]
  sealingKey: ReturnType<typeof sealingKeySource>
}> => {
  const { values, sources } = await resolveConfig()
  return {
    fields: CONFIG_FIELDS.map((f) => ({
      id: f.id,
      value: f.secret ? (values[f.id] ? SECRET_MASK : '') : (values[f.id] ?? ''),
      source: sources[f.id] ?? 'unset',
    })),
    sealingKey: sealingKeySource(),
  }
}

/**
 * Store a set of values. Semantics that matter to the caller:
 *
 * - a secret submitted still carrying the mask is left exactly as it was (the browser was
 *   never given the real value, so it cannot send it back)
 * - an empty value **deletes** the row, so the field falls back to the environment
 * - anything not in the registry is ignored rather than stored
 */
export const writeConfig = async (
  input: Record<string, string>,
  userId: number,
): Promise<string[]> => {
  const db = await getDb()
  const now = new Date()
  const changed: string[] = []
  const toDelete: string[] = []

  for (const [id, raw] of Object.entries(input)) {
    const field = FIELDS_BY_ID.get(id)
    if (!field) continue
    const value = raw.trim()
    if (field.secret && value.includes(SECRET_MASK)) continue // untouched
    if (value === '') {
      toDelete.push(id)
      changed.push(id)
      continue
    }
    await db
      .insert(appCredentials)
      .values({
        key: id,
        sealed: seal(value),
        isSecret: field.secret,
        updatedAt: now,
        updatedBy: userId,
      })
      .onConflictDoUpdate({
        target: appCredentials.key,
        set: { sealed: seal(value), isSecret: field.secret, updatedAt: now, updatedBy: userId },
      })
    changed.push(id)
  }

  if (toDelete.length) await db.delete(appCredentials).where(inArray(appCredentials.key, toDelete))

  return changed
}
