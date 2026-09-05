import { canReadChapter } from '@palscans/core'
import {
  chapters,
  getDb,
  MAX_OBSERVED_AGO_MS,
  mergeLocalProgress,
  observedAtFrom,
} from '@palscans/db'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { ok, parseJson, rateLimited, requireUser } from '@/lib/auth'
import { clientIp, getRateLimiter, ipKey } from '@/lib/auth/rate-limit'
import { entitlementGate } from '@/lib/entitlements'

/**
 * POST /api/progress/merge — the moment a signed-out reader signs in or registers.
 *
 * Everything the browser remembered while they were anonymous is offered here, each
 * position carrying its age rather than a clock reading, and folded into the account under
 * exactly the rule an ordinary write uses (`@palscans/db` `queries/progress.ts`): every
 * recognised chapter joins the history unconditionally, and the resume pointer per series
 * is contested by this device's most recent observation against whatever the account
 * already holds. Where the account is more recent, the account keeps its place — signing
 * in on a borrowed laptop cannot drag a series backwards — and where the device is, the
 * device wins. Nothing is deleted on either side.
 *
 * Idempotent by construction, so a client that retries (or a second tab that fires it
 * again) costs a query and changes nothing.
 */

/** A device that has read more chapters than this is not going to notice the tail. */
export const MERGE_LIMIT = 200

export const mergeSchema = z.object({
  positions: z
    .array(
      z.object({
        chapterId: z.number().int().positive(),
        pageIdx: z.number().int().min(0).max(4000),
        scrollPct: z.number().min(0).max(1).catch(0),
        observedAgoMs: z.number().min(0).max(MAX_OBSERVED_AGO_MS).catch(0),
      }),
    )
    .max(MERGE_LIMIT),
})

export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, mergeSchema)
  if (!parsed.ok) return parsed.response

  // Cheap, but it walks every chapter it is handed, so it is not free either: a handful of
  // merges per account per hour is more than any honest sign-in flow needs.
  const bucket = ipKey(clientIp(request)) ?? `u:${user.id}`
  const limit = await getRateLimiter().hit(`progress-merge:${bucket}`, 10, 3600)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)

  const now = new Date()
  const db = await getDb()
  const positions = parsed.data.positions.map((p) => ({
    chapterId: p.chapterId,
    pageIdx: p.pageIdx,
    scrollPct: p.scrollPct,
    observedAt: observedAtFrom(now, p.observedAgoMs),
  }))
  if (positions.length === 0)
    return ok({ userId: user.id, read: 0, advanced: 0, kept: 0, skipped: 0 })

  // Entitlements decide what this account may hold progress for, exactly as the per-write
  // route does — a chapter that went premium since the device read it is not merged in.
  const gate = await entitlementGate()
  const rows = await db
    .select({
      id: chapters.id,
      state: chapters.state,
      isPremium: chapters.isPremium,
      earlyAccessUntil: chapters.earlyAccessUntil,
    })
    .from(chapters)
    .where(inArray(chapters.id, [...new Set(positions.map((p) => p.chapterId))]))
  const access = new Map(rows.map((r) => [r.id, r]))
  const readable = (chapter: { id: number }): boolean => {
    const row = access.get(chapter.id)
    if (!row) return false
    return canReadChapter(
      user,
      {
        state: row.state,
        is_premium: row.isPremium,
        early_access_until: row.earlyAccessUntil,
      },
      { overrides: gate.overrides, now },
    )
  }

  const outcome = await mergeLocalProgress(db, user.id, positions, readable)
  return ok({ userId: user.id, ...outcome })
})
