import 'server-only'
import { sealingKeySource } from '@palscans/core'
import { getDb, readSealedCredentials } from '@palscans/db'
import { CONFIG_FIELDS, SECRET_MASK } from './registry'
import type { ConfigFieldView, ConfigSource } from './store'

/**
 * The same resolution as `resolveConfig()`, without the cache — for the admin panel only.
 *
 * `resolveConfig()` reads through a 300-second `unstable_cache` entry, which is exactly right
 * for the site: every request that builds an image URL or reaches for a Stripe key goes
 * through it. It is wrong for this one screen. `revalidateTag` marks a cache entry stale
 * rather than deleting it, and Next then serves that stale entry once while it refreshes in
 * the background — so the render immediately after a save shows the value from *before* the
 * save. On a page whose whole job is telling the operator what is stored, that is the one
 * mistake it cannot make.
 *
 * So the panel reads the rows itself, on the two requests per session where a fresh read
 * costs nothing. The site keeps the cache; the screen keeps the truth.
 */

export interface LiveConfig {
  values: Record<string, string>
  sources: Record<string, ConfigSource>
}

export interface ConfigPanelView {
  fields: ConfigFieldView[]
  sealingKey: ReturnType<typeof sealingKeySource>
}

export const liveConfig = async (): Promise<LiveConfig> => {
  let stored: Record<string, string> = {}
  try {
    stored = await readSealedCredentials(
      await getDb(),
      CONFIG_FIELDS.map((f) => f.id),
    )
  } catch {
    // No database, or it is down. The environment on its own still describes the deployment,
    // which is more useful to show than an error page.
  }
  const values: Record<string, string> = {}
  const sources: Record<string, ConfigSource> = {}
  for (const field of CONFIG_FIELDS) {
    const fromPanel = stored[field.id] ?? ''
    const fromEnv = (process.env[field.env] ?? '').trim()
    values[field.id] = fromPanel || fromEnv
    sources[field.id] = fromPanel ? 'panel' : fromEnv ? 'env' : 'unset'
  }
  return { values, sources }
}

/** What the panel is allowed to see: plain values as they are, secrets reduced to a mask. */
export const liveConfigView = async (): Promise<ConfigPanelView> => {
  const { values, sources } = await liveConfig()
  return {
    fields: CONFIG_FIELDS.map((f) => ({
      id: f.id,
      value: f.secret ? (values[f.id] ? SECRET_MASK : '') : (values[f.id] ?? ''),
      source: sources[f.id] ?? 'unset',
    })),
    sealingKey: sealingKeySource(),
  }
}
