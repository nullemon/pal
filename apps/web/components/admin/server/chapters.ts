import { getQueue } from '@palscans/core/queue'
import {
  bookmarks,
  type ChapterProcessing,
  chapters,
  type Db,
  getDb,
  notificationPrefs,
  notifications,
  series,
  seriesFollows,
} from '@palscans/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { entitlementOverrides } from '@/lib/entitlements'
import { mergeFollowers, splitRecipients } from '@/lib/notifications/follows'

/**
 * Chapter state transitions used by the bulk bar, the uploader and the retry button. The
 * worker owns the same transitions for scheduled chapters (apps/worker/src/jobs/publish.ts).
 */
export const PUBLISHABLE = ['draft', 'ready', 'scheduled', 'published'] as const

/**
 * Publish now: state → published, published_at kept if already in the past, followers
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
        await notifyFollowers(tx, r.id, r.seriesId, r.number)
      }
    }
  })
  return eligible.map((r) => r.id)
}

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>['transaction']>[0]>[0]

/**
 * The in-app row for a chapter the panel publishes immediately, to everyone **following**
 * the series — the same two gates the scheduled path applies in
 * `apps/worker/src/jobs/publish.ts`: the per-series `mode` (a bookmark with no
 * `series_follows` row is still an implicit follow on `all`) and the reader's global
 * `new_chapter × in_app` preference, whose rows are sparse so a missing one means "on".
 *
 * The button used to insert one row per bookmark and consult neither, which meant a reader
 * who muted a series still heard from it whenever a moderator pressed Publish now.
 */
export const notifyFollowers = async (
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
  const [follows, marks] = await Promise.all([
    tx
      .select({ userId: seriesFollows.userId, mode: seriesFollows.mode })
      .from(seriesFollows)
      .where(eq(seriesFollows.seriesId, seriesId)),
    tx.select({ userId: bookmarks.userId }).from(bookmarks).where(eq(bookmarks.seriesId, seriesId)),
  ])
  const followers = mergeFollowers(
    follows,
    marks.map((m) => m.userId),
  )
  if (followers.length === 0) return
  const prefs = await tx
    .select({
      userId: notificationPrefs.userId,
      kind: notificationPrefs.kind,
      channel: notificationPrefs.channel,
      enabled: notificationPrefs.enabled,
    })
    .from(notificationPrefs)
    .where(
      inArray(
        notificationPrefs.userId,
        followers.map((f) => f.userId),
      ),
    )
  const { allowed } = splitRecipients(followers, prefs, 'new_chapter', 'in_app')
  if (allowed.length === 0) return
  const payload = {
    chapterId,
    seriesId,
    number,
    seriesTitle: s?.title ?? '',
    seriesSlug: s?.slug ?? '',
  }
  await tx.insert(notifications).values(
    allowed.map((userId) => ({
      userId,
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

/**
 * "Does chapter N already exist, and may this person overwrite it?"
 *
 * One copy of the rule, used by the browser upload (`/api/upload/intent`) and the gallery
 * import (`/api/admin/chapters/import`). It was extracted rather than duplicated because
 * every branch here is a decision about destroying somebody's work: replacing the pages of a
 * published chapter needs an explicit `replace`, needs `chapter.repair`, and must never
 * happen to a chapter the worker is in the middle of. Two copies of that would have become
 * two different answers the first time one of them was edited.
 *
 * Takes the transaction, not the database, so the caller can abandon a batch and leave no
 * half-created chapters behind.
 */
export type ChapterSlot =
  | { ok: true; chapterId: number; reused: boolean; replaced: boolean }
  | { ok: false; code: 'chapter_exists'; pages: number }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'already_processing' }
  | { ok: false; code: 'insert_failed' }

export const resolveChapterSlot = async (
  tx: Pick<Awaited<ReturnType<typeof getDb>>, 'select' | 'insert'>,
  opts: {
    seriesId: number
    number: number
    /** Already normalised by the caller (migration 9044). */
    language: string
    title?: string | null
    /** The operator's answer to "it already exists": absent means refuse. */
    replace?: boolean
    canRepair: boolean
    userId: number
  },
): Promise<ChapterSlot> => {
  const [existing] = await tx
    .select({ id: chapters.id, state: chapters.state, pageCount: chapters.pageCount })
    .from(chapters)
    .where(
      and(
        eq(chapters.seriesId, opts.seriesId),
        eq(chapters.number, opts.number),
        // Without this a German chapter 1 matches the English one and the operator is
        // offered "replace its pages" for a chapter in another language.
        eq(chapters.language, opts.language),
        isNull(chapters.deletedAt),
      ),
    )
    .limit(1)
  if (existing) {
    if (existing.pageCount > 0 && opts.replace !== true)
      return { ok: false, code: 'chapter_exists', pages: existing.pageCount }
    if (existing.pageCount > 0 && !opts.canRepair) return { ok: false, code: 'forbidden' }
    if (existing.state === 'processing') return { ok: false, code: 'already_processing' }
    return {
      ok: true,
      chapterId: existing.id,
      reused: true,
      replaced: existing.pageCount > 0,
    }
  }
  const [created] = await tx
    .insert(chapters)
    .values({
      seriesId: opts.seriesId,
      number: opts.number,
      title: opts.title ?? null,
      language: opts.language,
      state: 'draft',
      uploadedBy: opts.userId,
    })
    .returning({ id: chapters.id })
  if (!created) return { ok: false, code: 'insert_failed' }
  return { ok: true, chapterId: created.id, reused: false, replaced: false }
}

/**
 * Enqueue the gallery download for a chapter whose `processing.fetch` is set.
 *
 * `delayMs` is how a manifest import spreads a backfill out. Without it, pasting a
 * hundred-chapter file opens a hundred near-simultaneous conversations with the image host,
 * which is the fastest way to get rate-limited by it.
 */
export const enqueueFetch = async (
  chapterId: number,
  attempt: number,
  delayMs = 0,
): Promise<string | null> => {
  try {
    const queue = await getQueue()
    return await queue.add(
      'chapter.fetch',
      { chapterId },
      {
        jobId: `chapter.fetch:${chapterId}:${attempt}`,
        attempts: 2,
        ...(delayMs > 0 ? { delayMs } : {}),
      },
    )
  } catch {
    return null
  }
}

/**
 * Why a chapter could not be pulled into our bucket. Reported per chapter rather than
 * summed, because "12 of 40 were skipped" without a reason is not something an operator can
 * act on.
 */
export type StorageSkipReason = 'already_ours' | 'processing' | 'deleted'

export interface StorageConversion {
  converted: number[]
  skipped: Array<{ id: number; reason: StorageSkipReason }>
}

/**
 * Re-download these chapters' pages into our own storage.
 *
 * The mechanism is the one the import panel already uses: the chapter's own
 * `processing.fetch` records where its pages came from, so converting it is that same
 * descriptor with `mode` flipped to `storage`, a bumped attempt, and `chapter.fetch` queued
 * again. Nothing is downloaded here — forty pages is eighty megabytes and this is a request
 * handler on a small box; the worker has the retries, the progress and the shutdown.
 *
 * **A chapter with no `fetch` descriptor is already ours.** That is not a guess: the fetch
 * job deletes the descriptor when it finishes in storage mode (`delete next.fetch`) and
 * keeps it when it finishes in remote mode, and a chapter uploaded through the browser never
 * had one. So its absence means the pages are in the bucket, by either route, and there is
 * nothing to convert.
 *
 * `after` is carried over untouched, so a published chapter comes back published rather than
 * quietly reverting to a draft while an operator is converting a back catalogue.
 */
export const convertChaptersToStorage = async (
  ids: number[],
  db?: Db,
): Promise<StorageConversion> => {
  const database = db ?? (await getDb())
  const rows = await database
    .select({
      id: chapters.id,
      state: chapters.state,
      processing: chapters.processing,
      deletedAt: chapters.deletedAt,
    })
    .from(chapters)
    .where(inArray(chapters.id, ids))

  const converted: number[] = []
  const skipped: StorageConversion['skipped'] = []
  for (const row of rows) {
    if (row.deletedAt) {
      skipped.push({ id: row.id, reason: 'deleted' })
      continue
    }
    const fetchDoc = row.processing?.fetch
    if (!fetchDoc || fetchDoc.mode !== 'remote') {
      skipped.push({ id: row.id, reason: 'already_ours' })
      continue
    }
    // A chapter mid-download would have its document overwritten underneath the running job.
    if (row.state === 'processing') {
      skipped.push({ id: row.id, reason: 'processing' })
      continue
    }
    const attempt = (row.processing?.attempt ?? 0) + 1
    const next: ChapterProcessing = {
      ...row.processing,
      sources: [],
      results: {},
      errors: {},
      progress: { done: 0, total: row.processing?.progress?.total ?? 0 },
      attempt,
      mode: 'all',
      fetch: { ...fetchDoc, mode: 'storage' },
      startedAt: null,
      finishedAt: null,
    }
    await database
      .update(chapters)
      .set({ state: 'processing', processing: next, updatedAt: new Date() })
      .where(eq(chapters.id, row.id))
    await enqueueFetch(row.id, attempt)
    converted.push(row.id)
  }
  return { converted, skipped }
}
