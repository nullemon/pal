import { getDb, MAX_OBSERVED_AGO_MS, observedAtFrom, writeProgress } from '@palscans/db'
import { z } from 'zod'
import { fail, notFound, ok, parseJson, requireUser } from '@/components/reader/server/auth'
import { chapterForApi, viewerCanRead } from '@/components/reader/server/data'
import { entitlementGate } from '@/lib/entitlements'

/**
 * POST /api/progress — the reader's position, written at most every 5s and once more on
 * `visibilitychange` through `navigator.sendBeacon` (docs/06 "Progress and offline").
 * Beacons arrive as a JSON blob; `parseJson` (streaming 64 KB cap) reads both.
 *
 * `reading_progress` holds one row per user × series, so every device the reader owns
 * writes to the same row and two of them can disagree. The rule that settles it lives in
 * `@palscans/db` `queries/progress.ts` — **the newest observation wins, the furthest
 * position breaks a tie** — and this route's only part in it is passing on the position's
 * age (`observedAgoMs`, measured on the device, never a clock reading) and reporting back
 * which position won, so a client that lost can adopt it instead of writing again.
 *
 * `chapter_reads` (history) is recorded either way: a late beacon still describes a
 * chapter that was genuinely read.
 */
export const progressSchema = z.object({
  chapterId: z.number().int().positive(),
  pageIdx: z.number().int().min(0).max(4000),
  scrollPct: z.number().min(0).max(1).catch(0),
  /**
   * How long ago, in milliseconds, the device was on this position. 0 (the default, and
   * what an older client sends) means "right now", which is exactly the old behaviour for
   * a reader who only ever uses one device.
   */
  observedAgoMs: z.number().min(0).max(MAX_OBSERVED_AGO_MS).catch(0),
})

export type ProgressInput = z.infer<typeof progressSchema>

export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, progressSchema)
  if (!parsed.ok) return parsed.response

  const chapter = await chapterForApi(parsed.data.chapterId)
  if (!chapter) return notFound()
  const now = new Date()
  const gate = await entitlementGate()
  const readable = viewerCanRead(
    user,
    {
      id: chapter.id,
      seriesId: chapter.seriesId,
      number: Number(chapter.number),
      volume: null,
      title: null,
      state: chapter.state,
      isPremium: chapter.isPremium,
      earlyAccessUntil: chapter.earlyAccessUntil ? chapter.earlyAccessUntil.toISOString() : null,
      publishedAt: null,
      pageCount: 0,
    },
    { overrides: gate.overrides, now },
  )
  if (!readable) return fail(403, 'forbidden')

  const db = await getDb()
  const { decision, winner } = await writeProgress(db, {
    userId: user.id,
    seriesId: chapter.seriesId,
    chapterId: chapter.id,
    chapterNumber: Number(chapter.number),
    pageIdx: parsed.data.pageIdx,
    scrollPct: parsed.data.scrollPct,
    observedAt: observedAtFrom(now, parsed.data.observedAgoMs),
  })

  // A refused write is a normal outcome, not an error: the reader's other device simply
  // knows better. 200 with the winning position, which the client adopts.
  return ok({
    accepted: decision === 'accepted',
    reason: decision,
    chapterId: winner.chapterId,
    pageIdx: winner.pageIdx,
    scrollPct: winner.scrollPct,
    savedAt: winner.readAt.toISOString(),
  })
})
