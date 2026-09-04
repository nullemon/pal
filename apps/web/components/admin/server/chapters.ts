import { getQueue } from '@palscans/core/queue'
import {
  bookmarks,
  type ChapterProcessing,
  chapters,
  getDb,
  notifications,
  series,
} from '@palscans/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { entitlementOverrides } from '@/lib/entitlements'

/**
 * Chapter state transitions used by the bulk bar, the uploader and the retry button. The
 * worker owns the same transitions for scheduled chapters (apps/worker/src/jobs/publish.ts).
 */
export const PUBLISHABLE = ['draft', 'ready', 'scheduled', 'published'] as const

/**
 * Publish now: state → published, published_at kept if already in the past, bookmarkers
 * notified. `series.last_chapter_at` is the counter trigger's to maintain.
 *
 * Applies the early-access window the same way the scheduler does, so a chapter published
 * from the panel behaves exactly like one that published on its own — Premium-only for
 * `entitlements.early_access_minutes`, then free to everyone. A window already set by hand
 * on the chapter wins.
 */
export const publishChapters = async (ids: number[], now = new Date()): Promise<number[]> => {
  if (ids.length === 0) return []
  const db = await getDb()
  const { early_access_minutes: minutes } = await entitlementOverrides()
  const earlyUntil = minutes > 0 ? new Date(now.getTime() + minutes * 60_000) : null
  const rows = await db
    .select({
      id: chapters.id,
      seriesId: chapters.seriesId,
      number: chapters.number,
      state: chapters.state,
      publishedAt: chapters.publishedAt,
      pageCount: chapters.pageCount,
      earlyAccessUntil: chapters.earlyAccessUntil,
    })
    .from(chapters)
    .where(and(inArray(chapters.id, ids), isNull(chapters.deletedAt)))
  const eligible = rows.filter(
    (r) => r.pageCount > 0 && (PUBLISHABLE as readonly string[]).includes(r.state),
  )
  if (eligible.length === 0) return []
  await db.transaction(async (tx) => {
    for (const r of eligible) {
      const publishedAt =
        r.publishedAt && r.publishedAt.getTime() <= now.getTime() && r.state === 'published'
          ? r.publishedAt
          : now
      await tx
        .update(chapters)
        .set({
          state: 'published',
          publishedAt,
          updatedAt: now,
          // Only for a chapter that is newly going live, and only when none is set already.
          ...(earlyUntil && r.state !== 'published' && !r.earlyAccessUntil
            ? { earlyAccessUntil: earlyUntil }
            : {}),
        })
        .where(eq(chapters.id, r.id))
      if (r.state !== 'published') {
        await tx
          .update(series)
          .set({
            updatedAt: now,
          })
          .where(eq(series.id, r.seriesId))
        await notifyBookmarkers(tx, r.id, r.seriesId, r.number)
      }
    }
  })
  return eligible.map((r) => r.id)
}

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>['transaction']>[0]>[0]

/** docs/04 "fans out notifications to bookmarkers" — one `new_chapter` row per bookmark. */
export const notifyBookmarkers = async (
  tx: Tx,
  chapterId: number,
  seriesId: number,
  number: number,
) => {
  const [s] = await tx
    .select({ title: series.title, slug: series.slug })
    .from(series)
    .where(eq(series.id, seriesId))
    .limit(1)
  const readers = await tx
    .select({ userId: bookmarks.userId })
    .from(bookmarks)
    .where(eq(bookmarks.seriesId, seriesId))
  if (readers.length === 0) return
  const payload = {
    chapterId,
    seriesId,
    number,
    seriesTitle: s?.title ?? '',
    seriesSlug: s?.slug ?? '',
  }
  await tx.insert(notifications).values(
    readers.map((r) => ({
      userId: r.userId,
      kind: 'new_chapter',
      payload,
      groupKey: `series:${seriesId}`,
    })),
  )
}

export const scheduleChapters = async (ids: number[], publishedAt: Date, now = new Date()) => {
  if (publishedAt.getTime() <= now.getTime()) return publishChapters(ids, now)
  const db = await getDb()
  const rows = await db
    .select({ id: chapters.id, state: chapters.state, pageCount: chapters.pageCount })
    .from(chapters)
    .where(and(inArray(chapters.id, ids), isNull(chapters.deletedAt)))
  const eligible = rows
    .filter((r) => r.pageCount > 0 && (PUBLISHABLE as readonly string[]).includes(r.state))
    .map((r) => r.id)
  if (eligible.length === 0) return []
  await db
    .update(chapters)
    .set({ state: 'scheduled', publishedAt, updatedAt: now })
    .where(inArray(chapters.id, eligible))
  return eligible
}

/** Enqueue `chapter.process` (docs/03 step 7); the worker also polls for stale `processing` rows without Redis. */
export const enqueueProcess = async (
  chapterId: number,
  attempt: number,
): Promise<string | null> => {
  try {
    const queue = await getQueue()
    return await queue.add(
      'chapter.process',
      { chapterId },
      { jobId: `chapter.process:${chapterId}:${attempt}`, attempts: 3 },
    )
  } catch {
    return null
  }
}

export const emptyProcessing = (sources: ChapterProcessing['sources']): ChapterProcessing => ({
  sources,
  progress: { done: 0, total: sources.length },
  errors: {},
  attempt: 0,
  mode: 'all',
  startedAt: null,
  finishedAt: null,
})
