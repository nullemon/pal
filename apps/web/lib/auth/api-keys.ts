import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SessionUser } from '@palscans/core'
import { apiKeys, getDb } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { loadSessionUser } from './session'

/**
 * API keys for machine callers (Admin → System → Remote).
 *
 * Migration 9017 removed an earlier `api_keys` table because it had no verification behind
 * it. This is the other half, and it is deliberately small, because the one design decision
 * that matters removes most of the code that would otherwise be here:
 *
 * **A key authenticates as a user.** It carries no scopes of its own. Verification ends by
 * calling `loadSessionUser`, the same function a cookie resolves through, so a key gets the
 * account's role, its configured permissions and its entitlements — and `can()` stays the
 * only thing in the codebase that decides access. A key for a banned or deleted account
 * stops working for free, because that check already lives in there.
 *
 * Issuing a key that may add series but not touch accounts therefore means pointing it at an
 * uploader account, not maintaining a second permission model that has to be kept in step
 * with the roles matrix forever.
 *
 * The token is `pal_<prefix>_<secret>`:
 *
 * - `prefix` is public. It is the indexed lookup, so verification is one row read rather than
 *   a scan and a hash of every key on the site, and it is what the panel shows so two keys
 *   can be told apart.
 * - `secret` is never stored. Only its sha256 is, exactly like `sessions.secret_hash`; the
 *   plaintext exists once, in the response that created it.
 */

/** Recognisable in a log or a config file, and greppable if one leaks. */
export const KEY_PREFIX = 'pal'
const PREFIX_BYTES = 6
const SECRET_BYTES = 32

export interface MintedKey {
  /** Shown once, never recoverable. */
  token: string
  prefix: string
  secretHash: Uint8Array
}

export const hashSecret = (secret: string): Uint8Array =>
  new Uint8Array(createHash('sha256').update(secret, 'utf8').digest())

/** A new key. The caller stores `prefix` and `secretHash`, and shows `token` exactly once. */
export const mintApiKey = (): MintedKey => {
  const prefix = randomBytes(PREFIX_BYTES).toString('hex')
  const secret = randomBytes(SECRET_BYTES).toString('base64url')
  return { token: `${KEY_PREFIX}_${prefix}_${secret}`, prefix, secretHash: hashSecret(secret) }
}

/**
 * Split a presented token. Returns null for anything malformed rather than throwing, so a
 * junk `Authorization` header is an ordinary 401 and not a 500.
 */
export const parseApiKey = (
  token: string | null | undefined,
): { prefix: string; secret: string } | null => {
  if (!token) return null
  const trimmed = token.trim()
  // Split on the *first two* underscores only — never `split('_')`. The secret is base64url,
  // whose alphabet includes `_`, so a fixed three-way split would reject every key whose
  // random secret happened to contain one: about a third of them, failing forever and only
  // for some keys, which is the worst shape a bug like this can have.
  const first = trimmed.indexOf('_')
  const second = trimmed.indexOf('_', first + 1)
  if (first <= 0 || second <= first + 1) return null
  const scheme = trimmed.slice(0, first)
  const prefix = trimmed.slice(first + 1, second)
  const secret = trimmed.slice(second + 1)
  if (scheme !== KEY_PREFIX || !prefix || !secret) return null
  if (!/^[0-9a-f]+$/.test(prefix)) return null
  return { prefix, secret }
}

/** The bearer token on a request, if it presented one. */
export const bearerToken = (request: Request): string | null => {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() ?? null
}

/**
 * Whether a stored key may still be used. Pure so the two ways a key dies — revoked by hand,
 * or past its expiry — are testable without a database, which is worth it for an auth path.
 */
export const keyIsUsable = (
  row: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date = new Date(),
): boolean => {
  if (row.revokedAt) return false
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false
  return true
}

/**
 * Resolve a presented key to the user it acts as, or null.
 *
 * Null for every failure — unknown prefix, wrong secret, revoked, expired, account gone or
 * banned — so a caller cannot tell which of those it was. The comparison is constant-time:
 * the prefix is public, but the secret's hash must not be guessable a byte at a time.
 */
export const userForApiKey = async (
  token: string | null | undefined,
): Promise<SessionUser | null> => {
  const parsed = parseApiKey(token)
  if (!parsed) return null
  const db = await getDb()
  const [row] = await db
    .select({
      id: apiKeys.id,
      secretHash: apiKeys.secretHash,
      userId: apiKeys.userId,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.prefix, parsed.prefix))
    .limit(1)
  if (!row) return null
  if (!keyIsUsable(row)) return null

  const presented = Buffer.from(hashSecret(parsed.secret))
  const stored = Buffer.from(row.secretHash)
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) return null

  // Bans and deletions are checked in here, so a key cannot outlive the account it acts as.
  const user = await loadSessionUser(row.userId)
  if (!user) return null

  // "Last used" is what tells an operator a key is still in something's config before they
  // revoke it. Best-effort: a failed write here must not fail an otherwise good request.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {})

  return user
}
