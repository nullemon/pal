import { randomInt } from 'node:crypto'
import { discordLinks } from '@palscans/db'
import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm'
import type { NotifyDb } from '../notifications/types'

/**
 * Per-user Discord linking (docs/17 §D). The reader asks for a code on `/me/notifications`,
 * types it at the bot, and the bot redeems it through
 * `POST /api/push/discord/redeem` — which leaves the snowflake in `discord_links`.
 *
 * Codes are short because a human retypes them, so they are also short-lived (15 minutes),
 * single-use, and cleared the moment they are spent. Nothing here works without
 * `DISCORD_BOT_TOKEN`; the callers check that and show "not configured".
 */

/** No 0/O/1/I/L — the code is read off a screen and typed into a chat box. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const LINK_CODE_LENGTH = 8
export const LINK_CODE_TTL_MS = 15 * 60_000

export const generateCode = (): string => {
  let out = ''
  for (let i = 0; i < LINK_CODE_LENGTH; i += 1) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

/** Normalise what a human typed: strip spaces and dashes, upper-case. */
export const normaliseCode = (raw: string): string =>
  raw.replace(/[\s-]/g, '').toUpperCase().slice(0, LINK_CODE_LENGTH)

export interface DiscordLink {
  userId: number
  discordId: string | null
  discordUsername: string | null
  code: string | null
  codeExpiresAt: Date | null
  linkedAt: Date | null
  rolesSyncedAt: Date | null
  syncedRoles: string[]
}

export const getLink = async (db: NotifyDb, userId: number): Promise<DiscordLink | null> => {
  const [row] = await db.select().from(discordLinks).where(eq(discordLinks.userId, userId)).limit(1)
  return row ?? null
}

/** Issue (or re-issue) a code for this reader. Replaces any unspent code they were holding. */
export const issueCode = async (
  db: NotifyDb,
  userId: number,
  now: Date = new Date(),
): Promise<{ code: string; expiresAt: Date }> => {
  const code = generateCode()
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS)
  await db
    .insert(discordLinks)
    .values({ userId, code, codeExpiresAt: expiresAt, updatedAt: now })
    .onConflictDoUpdate({
      target: discordLinks.userId,
      set: { code, codeExpiresAt: expiresAt, updatedAt: now },
    })
  return { code, expiresAt }
}

export type RedeemResult =
  | { ok: true; userId: number }
  | { ok: false; error: 'unknown_code' | 'expired' | 'already_linked' }

/**
 * Spend a code. The Discord id is unique across accounts, so a snowflake already attached to
 * someone else is refused rather than silently moved.
 */
export const redeemCode = async (
  db: NotifyDb,
  rawCode: string,
  discordId: string,
  discordUsername: string | null,
  now: Date = new Date(),
): Promise<RedeemResult> => {
  const code = normaliseCode(rawCode)
  if (code.length !== LINK_CODE_LENGTH) return { ok: false, error: 'unknown_code' }
  const [existing] = await db
    .select({ userId: discordLinks.userId })
    .from(discordLinks)
    .where(eq(discordLinks.discordId, discordId))
    .limit(1)
  const [row] = await db
    .select({ userId: discordLinks.userId, expiresAt: discordLinks.codeExpiresAt })
    .from(discordLinks)
    .where(eq(discordLinks.code, code))
    .limit(1)
  if (!row) return { ok: false, error: 'unknown_code' }
  if (existing && existing.userId !== row.userId) return { ok: false, error: 'already_linked' }
  if (!row.expiresAt || row.expiresAt.getTime() <= now.getTime())
    return { ok: false, error: 'expired' }
  await db
    .update(discordLinks)
    .set({
      discordId,
      discordUsername,
      linkedAt: now,
      code: null,
      codeExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(discordLinks.userId, row.userId))
  return { ok: true, userId: row.userId }
}

/**
 * Unlink. The row survives (it is the reader's linking state, not content) with its Discord
 * columns cleared, so a later re-link reuses it and the audit trail keeps `created_at`.
 */
export const unlink = async (db: NotifyDb, userId: number): Promise<void> => {
  await db
    .update(discordLinks)
    .set({
      discordId: null,
      discordUsername: null,
      linkedAt: null,
      code: null,
      codeExpiresAt: null,
      syncedRoles: [],
      rolesSyncedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(discordLinks.userId, userId))
}

/** Everyone with a live link — the population role sync and DMs work over. */
export const linkedAccounts = async (
  db: NotifyDb,
  limit = 1000,
): Promise<{ userId: number; discordId: string; syncedRoles: string[] }[]> => {
  const rows = await db
    .select({
      userId: discordLinks.userId,
      discordId: discordLinks.discordId,
      syncedRoles: discordLinks.syncedRoles,
    })
    .from(discordLinks)
    .where(isNotNull(discordLinks.discordId))
    .limit(limit)
  return rows.flatMap((r) =>
    r.discordId ? [{ userId: r.userId, discordId: r.discordId, syncedRoles: r.syncedRoles }] : [],
  )
}

export const countPendingCodes = async (db: NotifyDb, now: Date = new Date()): Promise<number> =>
  (
    await db
      .select({ userId: discordLinks.userId })
      .from(discordLinks)
      .where(
        and(
          isNull(discordLinks.discordId),
          isNotNull(discordLinks.code),
          gt(discordLinks.codeExpiresAt, now),
        ),
      )
  ).length
