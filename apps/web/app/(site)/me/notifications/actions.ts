'use server'

import { messages } from '@palscans/core/messages'
import { getDb, setFollowMode, unfollowSeries } from '@palscans/db'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSessionUser } from '@/lib/auth'
import { getLink, issueCode, unlink } from '@/lib/discord'
import { discordStatus } from '@/lib/env'
import { DIGEST_FREQUENCIES, followModeSchema, setDigestFrequency } from '@/lib/notifications'

/**
 * The reader's own notification settings that are not push subscriptions (docs/17 §D).
 *
 * These are Server Actions rather than route handlers on purpose: they are only ever called
 * by this page, Next checks the origin for us, and keeping them here means no new public API
 * surface for "change my digest frequency". Authorization is still `getSessionUser()` — the
 * client decides nothing.
 */
export type ActionResult = { ok: true; message: string } | { ok: false; message: string }

const PAGE = '/me/notifications'

const frequencySchema = z.enum(DIGEST_FREQUENCIES)

export async function saveDigestFrequency(raw: unknown): Promise<ActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: messages.errors.unauthorized }
  const parsed = frequencySchema.safeParse(raw)
  if (!parsed.success) return { ok: false, message: messages.errors.validation }
  const db = await getDb()
  await setDigestFrequency(db, user.id, parsed.data)
  revalidatePath(PAGE)
  return { ok: true, message: messages.notify.digest.saved }
}

export interface LinkCodeResult {
  ok: boolean
  message: string
  code?: string
  expiresAt?: string
}

export async function createDiscordCode(): Promise<LinkCodeResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: messages.errors.unauthorized }
  if (!(await discordStatus()).configured)
    return { ok: false, message: messages.notify.notConfigured }
  const db = await getDb()
  const existing = await getLink(db, user.id)
  if (existing?.discordId)
    return {
      ok: false,
      message: messages.notify.discord.linked.replace(
        '{name}',
        existing.discordUsername ?? existing.discordId,
      ),
    }
  const { code, expiresAt } = await issueCode(db, user.id)
  revalidatePath(PAGE)
  return { ok: true, message: code, code, expiresAt: expiresAt.toISOString() }
}

/**
 * Per-series notification settings (docs/17 §D). The management screen writes through these
 * rather than through `/api/follows/:id` for the same reason the digest does: the page is
 * the only caller, Next checks the origin, and `getSessionUser()` — never the client — says
 * whose follows are being changed.
 */
const seriesIdSchema = z.number().int().positive()

export async function saveFollowMode(
  rawSeriesId: unknown,
  rawMode: unknown,
): Promise<ActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: messages.errors.unauthorized }
  const seriesId = seriesIdSchema.safeParse(rawSeriesId)
  const mode = followModeSchema.safeParse(rawMode)
  if (!seriesId.success || !mode.success) return { ok: false, message: messages.errors.validation }
  const db = await getDb()
  if (!(await setFollowMode(db, user.id, seriesId.data, mode.data)))
    return { ok: false, message: messages.errors.notFound }
  revalidatePath(PAGE)
  return { ok: true, message: messages.follows.savedToast }
}

export type UnfollowResult = ActionResult & { muted?: boolean }

export async function unfollowSeriesAction(rawSeriesId: unknown): Promise<UnfollowResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: messages.errors.unauthorized }
  const seriesId = seriesIdSchema.safeParse(rawSeriesId)
  if (!seriesId.success) return { ok: false, message: messages.errors.validation }
  const db = await getDb()
  const outcome = await unfollowSeries(db, user.id, seriesId.data)
  revalidatePath(PAGE)
  return {
    ok: true,
    muted: outcome === 'muted',
    message: outcome === 'muted' ? messages.follows.modeHints.off : messages.follows.savedToast,
  }
}

export async function unlinkDiscord(): Promise<ActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: messages.errors.unauthorized }
  const db = await getDb()
  await unlink(db, user.id)
  revalidatePath(PAGE)
  return { ok: true, message: messages.notify.discord.unlinked }
}
