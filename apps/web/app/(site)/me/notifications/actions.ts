'use server'

import { messages } from '@palscans/core/messages'
import { getDb } from '@palscans/db'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSessionUser } from '@/lib/auth'
import { getLink, issueCode, unlink } from '@/lib/discord'
import { discordStatus } from '@/lib/env'
import { DIGEST_FREQUENCIES, setDigestFrequency } from '@/lib/notifications'

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
  if (!discordStatus().configured) return { ok: false, message: messages.notify.notConfigured }
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

export async function unlinkDiscord(): Promise<ActionResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, message: messages.errors.unauthorized }
  const db = await getDb()
  await unlink(db, user.id)
  revalidatePath(PAGE)
  return { ok: true, message: messages.notify.discord.unlinked }
}
