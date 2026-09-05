import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { chapterReads, chapters, readingProgress } from '../schema/index.js'

/**
 * Where a reader stopped, and what happens when two of their devices disagree about it.
 *
 * `reading_progress` holds one row per user × series — a *resume pointer*, not a log — so
 * every device that reads the series writes to the same row. Before this module the write
 * was a bare upsert: last to arrive won. A phone that read chapter 10 offline in the
 * morning and only flushed its beacon at night would silently drag the pointer back from
 * the chapter 12 the reader had reached on a laptop at lunchtime. Nothing in the row could
 * detect it, because `read_at` was set from the server clock at *arrival*.
 *
 * ## The rule: the newest observation wins; the furthest position breaks a tie
 *
 * A position is now stamped with **when the reader was actually looking at it**, and
 * `read_at` stores that instead of the arrival time. A write whose observation is older
 * than the stored one is refused (`stale`). Within {@link TIE_WINDOW_MS} the two
 * observations are treated as simultaneous — two tabs on one device, or a beacon racing a
 * throttled POST — and the further position through the series wins instead
 * ({@link comparePosition}), because a reader who is on both is on the later page.
 *
 * ### Why not "furthest progress always wins"
 *
 * It is the obvious rule and it is wrong in a way readers notice. Peek at the newest
 * chapter of a series you are ten chapters behind on — from a Latest rail, a Discord link,
 * a mis-tap — and furthest-wins pins your resume pointer to that chapter permanently. No
 * amount of reading where you actually are moves it back, because everything you read is
 * "behind". The same goes for re-reading, and for a shared household device. Newest-wins
 * is self-correcting: whatever you last genuinely read is where you resume, and the only
 * writes it rejects are the ones that arrive claiming to describe an *older* moment.
 *
 * ### Why an age rather than a timestamp
 *
 * The client sends `observedAgoMs` — how long ago *it* saw that position — never an
 * absolute clock reading, and the server re-bases it into server time
 * ({@link observedAtFrom}). Absolute client timestamps cannot be compared across devices:
 * a phone whose clock is a day fast would win every conflict forever, and one a day slow
 * would never win one. An elapsed interval measured on a single device inside a single
 * page view is trustworthy even when that device has no idea what day it is.
 *
 * `chapter_reads` (the history) is deliberately *not* subject to any of this: a stale
 * resume write still describes a chapter that was genuinely read, so the read is recorded
 * either way, with `read_at` only ever moving forward.
 */

/** Two observations this close together are simultaneous; the further position wins. */
export const TIE_WINDOW_MS = 10_000

/**
 * How far back a client may date a position. A month covers a phone that was offline for
 * a long holiday; past it the claim is not worth trusting and the position is treated as
 * current, where the ordinary comparison can still reject it.
 */
export const MAX_OBSERVED_AGO_MS = 30 * 24 * 3600 * 1000

/** `observedAgoMs` re-based into server time, clamped to [now - 30d, now]. */
export const observedAtFrom = (now: Date, observedAgoMs: number | undefined): Date => {
  const ago = Number.isFinite(observedAgoMs) ? Math.max(0, Number(observedAgoMs)) : 0
  return new Date(now.getTime() - Math.min(ago, MAX_OBSERVED_AGO_MS))
}

export interface ProgressPosition {
  /** Chapter number within the series — what "further" is measured in, not the row id. */
  chapterNumber: number
  pageIdx: number
  /** When the reader was looking at this position, in server time. */
  observedAt: Date
}

/**
 * Order two positions in the same series by how far through it they are: chapter first,
 * then page. Negative when `a` is behind `b`.
 */
export const comparePosition = (a: ProgressPosition, b: ProgressPosition): number =>
  a.chapterNumber !== b.chapterNumber ? a.chapterNumber - b.chapterNumber : a.pageIdx - b.pageIdx

export type ProgressDecision = 'accepted' | 'stale' | 'behind'

/**
 * The rule itself, as a pure function over the two positions — no database, so it can be
 * read and tested on its own.
 *
 * - `stale`: the incoming position describes an older moment than the stored one.
 * - `behind`: the two moments are simultaneous and the incoming position is not as far on.
 * - `accepted`: everything else, including the first write for a series (`stored` null).
 */
export const decideProgress = (
  stored: ProgressPosition | null,
  incoming: ProgressPosition,
): ProgressDecision => {
  if (!stored) return 'accepted'
  const drift = incoming.observedAt.getTime() - stored.observedAt.getTime()
  if (drift < -TIE_WINDOW_MS) return 'stale'
  if (drift > TIE_WINDOW_MS) return 'accepted'
  return comparePosition(incoming, stored) < 0 ? 'behind' : 'accepted'
}

export interface ProgressWrite {
  userId: number
  seriesId: number
  chapterId: number
  /** Needed to compare "further through the series"; the caller has it already. */
  chapterNumber: number
  pageIdx: number
  scrollPct: number
  observedAt: Date
}

export interface StoredProgress {
  chapterId: number
  chapterNumber: number
  pageIdx: number
  scrollPct: number
  readAt: Date
}

export interface ProgressWriteResult {
  decision: ProgressDecision
  /** The position that is now stored — the write's own, or the one that beat it. */
  winner: StoredProgress
}

/** The resume pointer for one series, with the chapter's number resolved. */
export const currentProgress = async (
  db: Db,
  userId: number,
  seriesId: number,
): Promise<StoredProgress | null> => {
  const [row] = await db
    .select({
      chapterId: readingProgress.chapterId,
      chapterNumber: chapters.number,
      pageIdx: readingProgress.pageIdx,
      scrollPct: readingProgress.scrollPct,
      readAt: readingProgress.readAt,
    })
    .from(readingProgress)
    .innerJoin(chapters, eq(chapters.id, readingProgress.chapterId))
    .where(and(eq(readingProgress.userId, userId), eq(readingProgress.seriesId, seriesId)))
    .limit(1)
  return row ? { ...row, chapterNumber: Number(row.chapterNumber) } : null
}

/**
 * Record that a chapter was read. Always applied, whatever the resume pointer decides,
 * and `read_at` only moves forward so a late beacon cannot make a chapter look newer or
 * older than it was.
 */
export const recordChapterRead = async (
  db: Db,
  userId: number,
  chapterId: number,
  readAt: Date,
): Promise<void> => {
  await db
    .insert(chapterReads)
    .values({ userId, chapterId, readAt })
    .onConflictDoUpdate({
      target: [chapterReads.userId, chapterReads.chapterId],
      set: { readAt: sql`greatest(${chapterReads.readAt}, excluded.read_at)` },
    })
}

/**
 * Apply one position under the rule above. Returns what happened and the position that is
 * stored afterwards, so a client that lost can adopt the winner instead of fighting it.
 */
export const writeProgress = async (db: Db, write: ProgressWrite): Promise<ProgressWriteResult> => {
  const stored = await currentProgress(db, write.userId, write.seriesId)
  const decision = decideProgress(
    stored
      ? {
          chapterNumber: stored.chapterNumber,
          pageIdx: stored.pageIdx,
          observedAt: stored.readAt,
        }
      : null,
    { chapterNumber: write.chapterNumber, pageIdx: write.pageIdx, observedAt: write.observedAt },
  )
  await recordChapterRead(db, write.userId, write.chapterId, write.observedAt)
  if (decision !== 'accepted' && stored) return { decision, winner: stored }

  const self: StoredProgress = {
    chapterId: write.chapterId,
    chapterNumber: write.chapterNumber,
    pageIdx: write.pageIdx,
    scrollPct: write.scrollPct,
    readAt: write.observedAt,
  }

  // The read above and this write are not one transaction: a second device writing in
  // between would be lost. The `where` re-checks the rule against the row as it is at
  // write time, in SQL, so the loser of that race is refused by the database rather than
  // by a decision taken from a stale read.
  const updated = await db
    .insert(readingProgress)
    .values({
      userId: write.userId,
      seriesId: write.seriesId,
      chapterId: write.chapterId,
      pageIdx: write.pageIdx,
      scrollPct: write.scrollPct,
      readAt: write.observedAt,
    })
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.seriesId],
      set: {
        chapterId: write.chapterId,
        pageIdx: write.pageIdx,
        scrollPct: write.scrollPct,
        readAt: write.observedAt,
      },
      setWhere: sql`${readingProgress.readAt} <= excluded.read_at + make_interval(secs => ${TIE_WINDOW_MS / 1000})`,
    })
    .returning({ chapterId: readingProgress.chapterId })
  if (updated.length > 0) return { decision: 'accepted', winner: self }
  // Nothing was written: another device beat this one to the row between the read and the
  // write. Report the position that is actually stored.
  const after = await currentProgress(db, write.userId, write.seriesId)
  return after ? { decision: 'stale', winner: after } : { decision: 'accepted', winner: self }
}

/* ------------------------------------------------------------------ merging a device in */

/** One locally-held position handed over when an anonymous reader signs in. */
export interface MergeCandidate {
  chapterId: number
  pageIdx: number
  scrollPct: number
  observedAt: Date
}

export interface MergeOutcome {
  /** Chapters recognised and merged into the history. */
  read: number
  /** Series whose resume pointer this device moved. */
  advanced: number
  /** Series where the account was already further on / more recent, so nothing moved. */
  kept: number
  /** Candidates whose chapter is gone, unpublished, or was sent twice. */
  skipped: number
}

/**
 * Fold a signed-out device's reading into an account, using exactly the rule above so
 * "what happens when the local record and the account disagree" has one answer.
 *
 * Every recognised chapter joins the history unconditionally — it *was* read. The resume
 * pointer per series is contested only once, by that device's most recent observation for
 * the series, against whatever the account already holds. The account wins where it is
 * more recent; the device wins where it is. Nothing is deleted either way.
 */
export const mergeLocalProgress = async (
  db: Db,
  userId: number,
  candidates: readonly MergeCandidate[],
  isReadable: (chapter: { id: number; seriesId: number; number: number }) => boolean = () => true,
): Promise<MergeOutcome> => {
  const ids = [...new Set(candidates.map((c) => c.chapterId))].filter(
    (id) => Number.isSafeInteger(id) && id > 0,
  )
  if (ids.length === 0) return { read: 0, advanced: 0, kept: 0, skipped: candidates.length }

  const rows = await db
    .select({
      id: chapters.id,
      seriesId: chapters.seriesId,
      number: chapters.number,
      state: chapters.state,
      deletedAt: chapters.deletedAt,
    })
    .from(chapters)
    .where(inArray(chapters.id, ids))
  const known = new Map(
    rows
      .filter((r) => r.state === 'published' && !r.deletedAt)
      .map((r) => [r.id, { id: r.id, seriesId: r.seriesId, number: Number(r.number) }]),
  )

  // One candidate per chapter (the most recent), and one contender per series.
  const perChapter = new Map<number, MergeCandidate>()
  for (const c of candidates) {
    const prev = perChapter.get(c.chapterId)
    if (!prev || c.observedAt > prev.observedAt) perChapter.set(c.chapterId, c)
  }

  const out: MergeOutcome = { read: 0, advanced: 0, kept: 0, skipped: 0 }
  const perSeries = new Map<number, { candidate: MergeCandidate; chapterNumber: number }>()
  for (const [chapterId, candidate] of perChapter) {
    const chapter = known.get(chapterId)
    if (!chapter || !isReadable(chapter)) {
      out.skipped++
      continue
    }
    await recordChapterRead(db, userId, chapterId, candidate.observedAt)
    out.read++
    const best = perSeries.get(chapter.seriesId)
    if (!best || candidate.observedAt > best.candidate.observedAt)
      perSeries.set(chapter.seriesId, { candidate, chapterNumber: chapter.number })
  }
  out.skipped += candidates.length - perChapter.size

  for (const [seriesId, { candidate, chapterNumber }] of perSeries) {
    const result = await writeProgress(db, {
      userId,
      seriesId,
      chapterId: candidate.chapterId,
      chapterNumber,
      pageIdx: candidate.pageIdx,
      scrollPct: candidate.scrollPct,
      observedAt: candidate.observedAt,
    })
    if (result.decision === 'accepted') out.advanced++
    else out.kept++
  }
  return out
}
