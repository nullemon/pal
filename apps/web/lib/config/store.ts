import 'server-only'
import { seal, sealingKeySource } from '@palscans/core'
import { appCredentials, getDb, readSealedCredentialsDetailed } from '@palscans/db'
import { inArray } from 'drizzle-orm'
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

/** Where a resolved value came from — surfaced in the panel so nothing is a mystery. */
export type ConfigSource = 'panel' | 'env' | 'unset'

export interface ResolvedConfig {
  values: Record<string, string>
  sources: Record<string, ConfigSource>
}

const envValue = (field: ConfigField): string => (process.env[field.env] ?? '').trim()

/**
 * How long a process reuses a decrypted read before going back to the database.
 *
 * Short, because this is the only invalidation there is across processes — see the note on
 * `purgeConfigCache` about why the Next cache cannot be used here. One small indexed query
 * every 30s per process is nothing next to what it buys.
 */
const CACHE_TTL_MS = 30_000

/**
 * Keys whose stored row exists but will not decrypt. Kept separate from the values because
 * "cannot be read" must not look like "not configured" to a security control — see
 * `credentialUnreadable`.
 */
let unreadableKeys = new Set<string>()

let memo: { values: Record<string, string>; at: number } | null = null
let inflight: Promise<Record<string, string>> | null = null

/**
 * The sealed rows, decrypted, memoised **in process only**.
 *
 * This deliberately does not use `unstable_cache`. That was the original implementation and
 * it silently defeated the encryption: `unstable_cache` persists its result as a `FETCH`
 * entry under `.next/cache/fetch-cache/`, so every decrypted credential — R2, Stripe, SMTP,
 * OAuth, VAPID, the Discord token — was written to disk as plaintext JSON, in production as
 * well as dev. Verified by storing a canary and finding it in the cache file. Anything that
 * can read the server's filesystem, a container layer, a mounted cache volume or a CI
 * artifact would have had the lot, and a stale entry outlived the credential's deletion.
 *
 * An in-process memo has the same effect on load and never leaves the process. It is the
 * same shape the worker already uses (apps/worker/src/lib/config.ts).
 */
const cachedStored = async (): Promise<Record<string, string>> => {
  const now = Date.now()
  if (memo && now - memo.at < CACHE_TTL_MS) return memo.values
  // Collapse a stampede: many concurrent renders on a cold memo make one query, not fifty.
  inflight ??= (async () => {
    try {
      // The unsealing itself lives in @palscans/db so the worker's resolver
      // (apps/worker/src/lib/config.ts) runs the same code rather than a second copy. A row
      // that will not open (the sealing key was rotated) comes back absent, so the
      // environment fallback takes over instead of the site breaking.
      const read = await readSealedCredentialsDetailed(
        await getDb(),
        CONFIG_FIELDS.map((f) => f.id),
      )
      unreadableKeys = new Set(read.unreadable)
      return read.values
    } catch {
      // No database yet, or it is down: the last good values, or the environment alone.
      return memo?.values ?? {}
    }
  })()
  try {
    const values = await inflight
    memo = { values, at: Date.now() }
    return values
  } finally {
    inflight = null
  }
}

/**
 * Drop this process's memo after a write, so the operator sees their own save immediately.
 * Other processes pick the change up within {@link CACHE_TTL_MS}.
 */
export const purgeConfigCache = (): void => {
  memo = null
  inflight = null
  unreadableKeys = new Set()
}

/**
 * True when this key has a stored row that could not be decrypted.
 *
 * A consumer that turns a feature off when its credential is absent must consult this and
 * fail closed instead: a rotated sealing key would otherwise silently disable the control
 * while the panel still lists it as stored.
 */
export const credentialUnreadable = async (id: string): Promise<boolean> => {
  await cachedStored()
  return unreadableKeys.has(id)
}

/** The same read, uncached — see `resolveConfig`'s `fresh` option for when that is needed. */
const freshStored = async (): Promise<Record<string, string>> => {
  try {
    const read = await readSealedCredentialsDetailed(
      await getDb(),
      CONFIG_FIELDS.map((f) => f.id),
    )
    unreadableKeys = new Set(read.unreadable)
    return read.values
  } catch {
    return {}
  }
}

/** Merge stored rows over the environment. The one place precedence is decided. */
const merge = (stored: Record<string, string>): ResolvedConfig => {
  const values: Record<string, string> = {}
  const sources: Record<string, ConfigSource> = {}
  for (const field of CONFIG_FIELDS) {
    const fromPanel = stored[field.id] ?? ''
    const fromEnv = envValue(field)
    values[field.id] = fromPanel || fromEnv
    sources[field.id] = fromPanel ? 'panel' : fromEnv ? 'env' : 'unset'
  }
  return { values, sources }
}

/**
 * Every registry key resolved to its effective value, with where it came from.
 *
 * Resolving also refreshes the synchronous mirror (`./mirror`), which is why nothing has to
 * hook the root layout to keep it warm — that layout is deliberately synchronous so `/` and
 * the series pages stay prerendered, and a database read there would make every route
 * dynamic. Instead the mirror is a write-through cache of this function: any async path that
 * reads configuration keeps it current, and the loaders that build storage URLs await
 * `ensureConfig()` (lib/config/install.ts) before doing so.
 *
 * `fresh` skips the cache. The admin panel needs it: `revalidateTag` marks an entry stale
 * rather than deleting it, and Next serves the stale entry once while it refreshes, so the
 * render straight after a save would show the value from *before* the save. On the one screen
 * whose job is reporting what is stored, that is the mistake it cannot make. Everything else
 * — every image URL, every Stripe key lookup — wants the cache.
 */
export const resolveConfig = async (opts: { fresh?: boolean } = {}): Promise<ResolvedConfig> => {
  const resolved = merge(opts.fresh ? await freshStored() : await cachedStored())
  const driver = resolved.values['storage.driver']
  setConfigMirror({
    driver: driver === 'fs' ? 'fs' : 's3',
    cdnUrl: resolved.values['storage.public_cdn_url'] ?? '',
  })
  return resolved
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
  const { values, sources } = await resolveConfig({ fresh: true })
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

  // Own the invalidation here rather than leaving it to each caller: a write that is not
  // visible to the next read in the same process is a footgun, and the memo is this module's
  // to manage.
  purgeConfigCache()
  return changed
}
