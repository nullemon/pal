import { open } from '@palscans/core'
import { inArray } from 'drizzle-orm'
import type { Db } from './client.js'
import { appCredentials } from './schema/credentials.js'

/**
 * Reading the sealed `app_credentials` rows (docs/19).
 *
 * It lives here rather than in either app because both need it and the logic is exactly one
 * thing: select the rows, unseal them, and drop anything that will not open. Both apps
 * wrap it in a short in-process TTL (`apps/web/lib/config/store.ts`,
 * `apps/worker/src/lib/config.ts`) — never in Next's cache, which would write the decrypted
 * values to disk. Neither owns a second copy of the decryption rules.
 */

export interface SealedRead {
  /** The rows that opened, keyed by registry id. */
  values: Record<string, string>
  /**
   * Keys whose row exists but could not be decrypted — a rotated sealing key, a truncated
   * ciphertext. **Not the same as absent**, and the difference is security-relevant: a
   * consumer that treats "no secret" as "this feature is off" would silently turn a control
   * off. Turnstile is the sharp example — its verifier passes every request when no secret
   * is configured, so an unreadable row must fail closed rather than look unconfigured.
   */
  unreadable: string[]
}

/**
 * The stored credentials, unsealed, with the rows that would not open reported separately.
 *
 * An empty plaintext is dropped: "" and "not stored" must mean the same thing to every
 * consumer.
 */
export const readSealedCredentialsDetailed = async (
  db: Db,
  keys?: readonly string[],
): Promise<SealedRead> => {
  if (keys && keys.length === 0) return { values: {}, unreadable: [] }
  const query = db
    .select({ key: appCredentials.key, sealed: appCredentials.sealed })
    .from(appCredentials)
  const rows = await (keys ? query.where(inArray(appCredentials.key, keys)) : query)
  const values: Record<string, string> = {}
  const unreadable: string[] = []
  for (const row of rows) {
    const value = open(row.sealed)
    if (value === null) unreadable.push(row.key)
    else if (value !== '') values[row.key] = value
  }
  return { values, unreadable }
}

/**
 * The stored credentials only. Callers that make a security decision on absence should use
 * {@link readSealedCredentialsDetailed} instead, so they can tell "not set" from "cannot be
 * read".
 */
export const readSealedCredentials = async (
  db: Db,
  keys?: readonly string[],
): Promise<Record<string, string>> => (await readSealedCredentialsDetailed(db, keys)).values
