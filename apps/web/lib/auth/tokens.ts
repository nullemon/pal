import { createHash, randomBytes } from 'node:crypto'
import { authTokens, getDb } from '@palscans/db'
import { and, eq, gt, isNull } from 'drizzle-orm'

/**
 * Single-use, hashed tokens for email verification and password reset (docs/02
 * `auth_tokens`). The raw token only ever exists in the email link.
 */
export type TokenPurpose = 'verify_email' | 'reset_password'

export const TOKEN_TTL_SEC: Record<TokenPurpose, number> = {
  verify_email: 24 * 3600,
  reset_password: 3600,
}

export const hashToken = (raw: string): Uint8Array =>
  new Uint8Array(createHash('sha256').update(raw, 'utf8').digest())

export const issueToken = async (userId: number, purpose: TokenPurpose): Promise<string> => {
  const raw = randomBytes(32).toString('base64url')
  const db = await getDb()
  // one live token per purpose: retire earlier ones so an old email link cannot race a new one
  await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
      ),
    )
  await db.insert(authTokens).values({
    userId,
    purpose,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + TOKEN_TTL_SEC[purpose] * 1000),
  })
  return raw
}

/** Look up a live token without consuming it (reset page: show the form only for valid links). */
export const peekToken = async (
  raw: string,
  purpose: TokenPurpose,
): Promise<{ userId: number } | null> => {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(raw)) return null
  const db = await getDb()
  const [row] = await db
    .select({ userId: authTokens.userId })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(raw)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Consume a token: returns the user id once, null for unknown / expired / used. */
export const consumeToken = async (
  raw: string,
  purpose: TokenPurpose,
): Promise<{ userId: number } | null> => {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(raw)) return null
  const db = await getDb()
  const rows = await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(raw)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: authTokens.userId })
  return rows[0] ?? null
}
