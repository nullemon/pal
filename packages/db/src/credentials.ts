import { open } from '@palscans/core'
import { inArray } from 'drizzle-orm'
import type { Db } from './client.js'
import { appCredentials } from './schema/credentials.js'

/**
 * Reading the sealed `app_credentials` rows (docs/19).
 *
 * It lives here rather than in either app because both need it and the logic is exactly one
 * thing: select the rows, unseal them, and drop anything that will not open. The web app
 * wraps this in Next's tagged cache (`apps/web/lib/config/store.ts`) so an admin save is
 * visible immediately; the worker wraps it in a short TTL (`apps/worker/src/lib/config.ts`).
 * Neither owns a second copy of the decryption rules.
 */

/**
 * The stored credentials, unsealed, keyed by registry id.
 *
 * A row that will not open — the sealing key was rotated, the ciphertext is truncated — is
 * treated as **absent** rather than as an error, so the environment fallback takes over
 * instead of the site breaking. An empty plaintext is dropped for the same reason: "" and
 * "not stored" must mean the same thing to every consumer.
 */
export const readSealedCredentials = async (
  db: Db,
  keys?: readonly string[],
): Promise<Record<string, string>> => {
  if (keys && keys.length === 0) return {}
  const query = db
    .select({ key: appCredentials.key, sealed: appCredentials.sealed })
    .from(appCredentials)
  const rows = await (keys ? query.where(inArray(appCredentials.key, keys)) : query)
  const out: Record<string, string> = {}
  for (const row of rows) {
    const value = open(row.sealed)
    if (value !== null && value !== '') out[row.key] = value
  }
  return out
}
