import { chapterReads, getDb, readingProgress } from '@palscans/db'
import { z } from 'zod'
import { fail, notFound, ok, parseJson, requireUser } from '@/components/reader/server/auth'
import { chapterForApi, viewerCanRead } from '@/components/reader/server/data'
import { entitlementGate } from '@/lib/entitlements'

/**
 * POST /api/progress — the reader's position, written at most every 5s and once more on
 * `visibilitychange` through `navigator.sendBeacon` (docs/06 "Progress and offline").
 * Beacons arrive as a JSON blob; `parseJson` (streaming 64 KB cap) reads both. Upserts
 * `reading_progress` (one row per user × series: resume) and `chapter_reads` (history).
 */
export const progressSchema = z.object({
  chapterId: z.number().int().positive(),
  pageIdx: z.number().int().min(0).max(4000),
  scrollPct: z.number().min(0).max(1).catch(0),
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
  await Promise.all([
    db
      .insert(readingProgress)
      .values({
        userId: user.id,
        seriesId: chapter.seriesId,
        chapterId: chapter.id,
        pageIdx: parsed.data.pageIdx,
        scrollPct: parsed.data.scrollPct,
        readAt: now,
      })
      .onConflictDoUpdate({
        target: [readingProgress.userId, readingProgress.seriesId],
        set: {
          chapterId: chapter.id,
          pageIdx: parsed.data.pageIdx,
          scrollPct: parsed.data.scrollPct,
          readAt: now,
        },
      }),
    db
      .insert(chapterReads)
      .values({ userId: user.id, chapterId: chapter.id, readAt: now })
      .onConflictDoUpdate({
        target: [chapterReads.userId, chapterReads.chapterId],
        set: { readAt: now },
      }),
  ])
  return ok({ chapterId: chapter.id, pageIdx: parsed.data.pageIdx, savedAt: now.toISOString() })
})
