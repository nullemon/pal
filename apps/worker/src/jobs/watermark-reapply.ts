import type { Storage } from '@palscans/core/storage'
import {
  normalizeWatermark,
  normalizeWatermarkRun,
  WATERMARK_REAPPLY_KEY,
  WATERMARK_RUN_PROBLEM_LIMIT,
  WATERMARK_SETTING_KEY,
  type WatermarkConfig,
  type WatermarkRun,
  type WatermarkRunProblem,
  type WatermarkSkipReason,
  watermarkFingerprint,
} from '@palscans/core/watermark'
import {
  type ChapterProcessing,
  chapterPages,
  chapters,
  type Db,
  getSetting,
  mergeSetting,
  type PageVariant,
  type ProcessedPage,
  settings,
} from '@palscans/db'
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import {
  plannedAddresses,
  processImage,
  variantKey,
  watermarkFontAvailable,
  widthsFor,
} from '../lib/image.js'
import { log } from '../lib/log.js'
import { pool } from '../lib/pool.js'
import { revalidateWeb } from '../lib/revalidate.js'

/**
 * `watermark.reapply` (docs/03 "Re-applying the mark"): bring chapters that are already
 * processed onto the watermark configured now.
 *
 * The pipeline folds the mark into the content address, so turning the watermark on or
 * editing it changes nothing that already exists — every published chapter keeps whatever it
 * was processed with, in the reader and in every download, forever. This is the job that
 * closes that gap.
 *
 * Two properties are load-bearing, and both are structural rather than careful:
 *
 * - **It can never mark an image twice.** Its only input is `chapters.processing.sources` —
 *   the uploaded originals under `uploads/` — checked for that prefix before a byte is read.
 *   It never reads a `pages/` object, so there is no path by which a marked image reaches
 *   the compositor. A chapter whose originals have gone is *reported*, not guessed at.
 * - **It is resumable and it yields.** The run document is the checkpoint, committed after
 *   every chapter, and each chapter waits for the publish pipeline to go quiet before it
 *   starts. An upload always wins; a killed worker costs one chapter of work.
 *
 * Superseded page objects are left in place rather than deleted — see `orphanBytes` and the
 * note in docs/03.
 */

/** Originals live here (docs/03 upload flow). Nothing outside this prefix is ever composited. */
export const UPLOAD_PREFIX = 'uploads/'

/** Chapters looked at per query. Small: the run reads its own control row between batches. */
export const REAPPLY_BATCH = 25

export interface ReapplyDeps {
  db: Db
  storage: Storage
  /**
   * Pages encoded at once inside one chapter. Deliberately a fraction of the pipeline's:
   * this job is a background sweep and must not be the reason an upload is slow.
   */
  pageConcurrency?: number
  /** Idle gap between chapters, so a catalogue-wide run never pegs the box. */
  pauseMs?: number
  /** How long one chapter will wait for the publish pipeline to go quiet before giving up. */
  yieldTimeoutMs?: number
  yieldPollMs?: number
  /** Test seam: stop after this many chapters, leaving the run resumable. */
  maxChapters?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

export type ReapplyStatus = 'rewritten' | 'current' | 'skipped'

export interface ReapplyOutcome {
  status: ReapplyStatus
  reason?: WatermarkSkipReason
  detail?: string
  /** Pages the chapter has (rewritten or confirmed). */
  pages: number
  /** Bytes of variants this chapter stopped referencing. */
  orphanBytes: number
  seriesId?: number
  number?: number
}

const errorMessage = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).slice(0, 300)

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Raised when the chapter moved under us between the encode and the row swap. */
class ConcurrentChange extends Error {}

export const readWatermarkRun = async (db: Db): Promise<WatermarkRun | null> =>
  normalizeWatermarkRun(
    await getSetting<unknown>(db, WATERMARK_REAPPLY_KEY, null).catch(() => null),
  )

/**
 * Write only the fields this run owns — and deliberately nothing that writes it whole.
 *
 * The panel writes `cancelRequested` into the same document while the run is walking. If the
 * worker wrote the whole document back at every checkpoint, a Stop pressed at any point
 * during a chapter would be silently thrown away by the checkpoint that follows it — which
 * is exactly what happened before this was a merge. Guarded on the run id so a checkpoint
 * from a run the operator has already replaced cannot resurrect it.
 */
export const patchWatermarkRun = async (
  db: Db,
  runId: string,
  patch: Partial<WatermarkRun>,
): Promise<boolean> =>
  mergeSetting(
    db,
    WATERMARK_REAPPLY_KEY,
    patch as Record<string, unknown>,
    sql`(${settings.value} ->> 'id') = ${runId}`,
    // `updated_by` stays whoever started the run: the worker is not a person.
    undefined,
  )

/**
 * The mark a run should apply, or a reason it must not run at all.
 *
 * The font probe is the important half. `node:22-alpine` ships no face and librsvg fails
 * silently on a missing one, so a fontless host would compose an empty overlay: the pipeline
 * refuses in that case and processes unmarked, which is a warning on one chapter. Doing the
 * same here would quietly rewrite *the entire catalogue* to unmarked pages and report
 * success, so this refuses outright instead.
 */
export const resolveRunMark = async (
  db: Db,
): Promise<
  | { ok: true; config: WatermarkConfig; mark: WatermarkConfig | null; fingerprint: string }
  | { ok: false; error: 'no_font' }
> => {
  const config = normalizeWatermark(
    await getSetting<unknown>(db, WATERMARK_SETTING_KEY, null).catch(() => null),
  )
  if (config.enabled && !(await watermarkFontAvailable())) return { ok: false, error: 'no_font' }
  return {
    ok: true,
    config,
    mark: config.enabled ? config : null,
    fingerprint: watermarkFingerprint(config),
  }
}

/** The widest WebP is the row's `key` (docs/03), which is what `chapter_pages` stores. */
const largestWidth = (sourceWidth: number): number => {
  const widths = widthsFor(sourceWidth)
  return widths[widths.length - 1] ?? sourceWidth
}

const sameKeys = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((k, i) => k === b[i])

/**
 * At most this many entries of any one reason.
 *
 * A catalogue imported without its originals has thousands of chapters that can never be
 * re-marked; without a per-reason cap they would fill the whole report and hide the one
 * chapter that failed for an interesting reason. The counters still tally every skip, and
 * the panel's own column lists them all — this is only about which examples get kept.
 */
export const PROBLEMS_PER_REASON = 50

export const recordProblem = (
  problems: readonly WatermarkRunProblem[],
  next: WatermarkRunProblem,
): WatermarkRunProblem[] => {
  if (problems.length >= WATERMARK_RUN_PROBLEM_LIMIT) return [...problems]
  if (problems.filter((p) => p.reason === next.reason).length >= PROBLEMS_PER_REASON)
    return [...problems]
  return [...problems, next]
}

/**
 * Re-mark one chapter from its originals.
 *
 * Never partial: every variant is written to storage before a single row moves, and the row
 * swap happens in one transaction that re-checks the chapter has not changed underneath it.
 * A failure anywhere leaves `chapter_pages` pointing at the objects it pointed at before,
 * all of which still exist.
 */
export const reapplyChapter = async (
  chapterId: number,
  mark: WatermarkConfig | null,
  fingerprint: string,
  deps: ReapplyDeps,
): Promise<ReapplyOutcome> => {
  const { db, storage } = deps
  const now = deps.now ?? (() => new Date())
  const [row] = await db
    .select({
      id: chapters.id,
      seriesId: chapters.seriesId,
      number: chapters.number,
      state: chapters.state,
      processing: chapters.processing,
      deletedAt: chapters.deletedAt,
    })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)

  const skip = (reason: WatermarkSkipReason, detail?: string): ReapplyOutcome => ({
    status: 'skipped',
    reason,
    detail,
    pages: 0,
    orphanBytes: 0,
    seriesId: row?.seriesId,
    number: row?.number,
  })

  if (!row || row.deletedAt) return skip('failed', 'chapter is gone')
  // Leave anything the pipeline is holding to the pipeline: it applies the current mark on
  // its own, and two writers rebuilding one chapter's rows is not worth the lock.
  if (row.state === 'processing') return skip('processing')

  const sources = row.processing?.sources ?? []
  if (sources.length === 0) return skip('no_sources')
  // The guard that makes double-marking impossible rather than unlikely: composite only from
  // an uploaded original. A `pages/…` key here would be an already-marked image.
  const foreign = sources.find((s) => !s.key.startsWith(UPLOAD_PREFIX))
  if (foreign) return skip('foreign_sources', foreign.key)

  const heads = await Promise.all(sources.map((s) => storage.head(s.key).catch(() => null)))
  const missing = heads.filter((h) => !h).length
  if (missing > 0)
    return skip(
      'missing_originals',
      `${missing} of ${sources.length} original${sources.length === 1 ? '' : 's'} no longer in storage`,
    )

  const existing = await db
    .select({ idx: chapterPages.idx, key: chapterPages.key, variants: chapterPages.variants })
    .from(chapterPages)
    .where(eq(chapterPages.chapterId, chapterId))
    .orderBy(asc(chapterPages.idx))
  const prefix = `pages/${row.seriesId}/${chapterId}`
  const recorded = row.processing?.watermark
  // The pipeline wrote this fingerprint in the same transaction as the rows below it, so it
  // describes the objects `chapter_pages` points at. A sweep filters these out in SQL; a
  // named selection reaches here, and gets an immediate honest answer rather than a re-encode.
  if (recorded === fingerprint)
    return {
      status: 'current',
      pages: existing.length,
      orphanBytes: 0,
      seriesId: row.seriesId,
      number: row.number,
    }

  try {
    // Chapters processed before the fingerprint was recorded carry an unknown mark. Rather
    // than assume, derive: hash the original the way the pipeline would and see whether the
    // keys it wants are the keys the chapter already has. Ten times cheaper than finding out
    // by re-encoding, and it settles `unknown` for good either way.
    if (recorded === undefined) {
      const wanted: string[] = []
      for (const source of [...sources].sort((a, b) => a.idx - b.idx)) {
        const bytes = await storage.get(source.key)
        if (!bytes) return skip('missing_originals', `original vanished: ${source.key}`)
        for (const page of await plannedAddresses(bytes, mark))
          wanted.push(
            variantKey(
              prefix,
              source.idx * 10 + page.offset,
              page.sha,
              largestWidth(page.width),
              'webp',
            ),
          )
      }
      if (
        sameKeys(
          wanted,
          existing.map((e) => e.key),
        )
      ) {
        await recordFingerprint(db, chapterId, fingerprint, now())
        return {
          status: 'current',
          pages: existing.length,
          orphanBytes: 0,
          seriesId: row.seriesId,
          number: row.number,
        }
      }
    }

    // Encode everything before anything is written to the database.
    const results: Record<number, ProcessedPage[]> = {}
    await pool(sources, Math.max(1, deps.pageConcurrency ?? 2), async (source) => {
      const original = await storage.get(source.key)
      if (!original) throw new Error(`missing object ${source.key}`)
      const encoded = await processImage(original, {
        prefix,
        startIdx: source.idx * 10,
        watermark: mark,
      })
      const pages: ProcessedPage[] = []
      for (const page of encoded) {
        for (const v of page.variants) {
          await storage.put(v.key, v.data, {
            contentType: v.fmt === 'avif' ? 'image/avif' : 'image/webp',
            cacheControl: 'public, max-age=31536000, immutable',
          })
        }
        const largestWebp = [...page.variants]
          .filter((v) => v.fmt === 'webp')
          .sort((a, b) => b.w - a.w)[0]
        if (!largestWebp) throw new Error('no variants')
        const variants: PageVariant[] = page.variants.map((v) => ({
          w: v.w,
          fmt: v.fmt,
          bytes: v.bytes,
          key: v.key,
        }))
        pages.push({
          key: largestWebp.key,
          width: page.width,
          height: page.height,
          bytes: largestWebp.bytes,
          blurHash: page.blurHash,
          variants,
        })
      }
      results[source.idx] = pages
    })

    const rows: Array<typeof chapterPages.$inferInsert> = []
    for (const source of [...sources].sort((a, b) => a.idx - b.idx))
      for (const r of results[source.idx] ?? [])
        rows.push({
          chapterId,
          idx: rows.length,
          key: r.key,
          width: r.width,
          height: r.height,
          bytes: r.bytes,
          blurHash: r.blurHash,
          variants: r.variants,
        })
    if (rows.length === 0) return skip('failed', 'no pages produced')

    // The recorded fingerprint said stale but the addresses agree: the chapter already
    // carries this mark. Byte-identical objects were just rewritten to the same keys, which
    // is harmless; the rows do not need to move.
    if (
      sameKeys(
        rows.map((r) => r.key),
        existing.map((e) => e.key),
      )
    ) {
      await recordFingerprint(db, chapterId, fingerprint, now())
      return {
        status: 'current',
        pages: rows.length,
        orphanBytes: 0,
        seriesId: row.seriesId,
        number: row.number,
      }
    }

    const fresh = new Set<string>()
    for (const r of rows) for (const v of r.variants ?? []) if (v.key) fresh.add(v.key)
    let orphanBytes = 0
    for (const e of existing)
      for (const v of e.variants ?? []) if (v.key && !fresh.has(v.key)) orphanBytes += v.bytes

    const at = now()
    await db.transaction(async (tx) => {
      const [check] = await tx
        .select({ state: chapters.state, processing: chapters.processing })
        .from(chapters)
        .where(eq(chapters.id, chapterId))
        .limit(1)
      if (!check || check.state === 'processing') throw new ConcurrentChange('state moved')
      const nowSources = check.processing?.sources ?? []
      if (
        nowSources.length !== sources.length ||
        nowSources.some((s, i) => s.key !== sources[i]?.key)
      )
        throw new ConcurrentChange('sources changed')
      const doc: ChapterProcessing | null = check.processing
        ? { ...check.processing, results: undefined, watermark: fingerprint }
        : null
      await tx.delete(chapterPages).where(eq(chapterPages.chapterId, chapterId))
      await tx.insert(chapterPages).values(rows)
      await tx
        .update(chapters)
        .set({ pageCount: rows.length, processing: doc, updatedAt: at })
        .where(eq(chapters.id, chapterId))
    })
    return {
      status: 'rewritten',
      pages: rows.length,
      orphanBytes,
      seriesId: row.seriesId,
      number: row.number,
    }
  } catch (err) {
    if (err instanceof ConcurrentChange) return skip('processing', err.message)
    return skip('failed', errorMessage(err))
  }
}

/** Stamp what a chapter's pages carry without touching the pages themselves. */
const recordFingerprint = async (
  db: Db,
  chapterId: number,
  fingerprint: string,
  at: Date,
): Promise<void> => {
  const [row] = await db
    .select({ processing: chapters.processing })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)
  if (!row?.processing) return
  await db
    .update(chapters)
    .set({
      processing: { ...row.processing, results: undefined, watermark: fingerprint },
      updatedAt: at,
    })
    .where(eq(chapters.id, chapterId))
}

/**
 * What a run walks, and the one place the two kinds of run differ.
 *
 * **A catalogue sweep does what can be done.** It takes chapters that still have originals
 * and whose recorded mark is not already this one — `is distinct from` is what makes a
 * re-run of a finished sweep nearly free, since anything the pipeline stamped with this
 * exact mark never leaves the database. Chapters with no originals at all are left out on
 * purpose: no run can ever fix them, and walking tens of thousands of them every time would
 * fill the report with the one thing it cannot act on. They are not hidden — the panel
 * counts them permanently and Chapters → Mark lists every one.
 *
 * **A selection is answered chapter by chapter.** When the operator has named chapters, every
 * one of them is walked whatever state it is in, so each gets an outcome: rebuilt, already
 * correct, or a reason it could not be done. Silently doing nothing to a chapter somebody
 * explicitly picked is the failure mode worth spending a few extra queries to avoid.
 */
const candidateWhere = (run: WatermarkRun, after?: number) =>
  and(
    isNull(chapters.deletedAt),
    gt(chapters.pageCount, 0),
    sql`${chapters.state} <> 'processing'`,
    after === undefined ? undefined : gt(chapters.id, after),
    run.scope
      ? inArray(chapters.id, run.scope)
      : and(
          sql`(${chapters.processing} is not null and jsonb_array_length(coalesce(${chapters.processing} -> 'sources', '[]'::jsonb)) > 0)`,
          sql`(${chapters.processing} ->> 'watermark') is distinct from ${run.fingerprint}`,
        ),
  )

export const nextCandidates = async (
  db: Db,
  run: WatermarkRun,
  limit = REAPPLY_BATCH,
): Promise<number[]> => {
  const rows = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(candidateWhere(run, run.cursor))
    .orderBy(asc(chapters.id))
    .limit(limit)
  return rows.map((r) => r.id)
}

export const countCandidates = async (db: Db, run: WatermarkRun): Promise<number> => {
  const [row] = await db.select({ n: count() }).from(chapters).where(candidateWhere(run))
  return row?.n ?? 0
}

/**
 * Hold off while the pipeline is busy.
 *
 * A catalogue-wide sweep is tens of thousands of CPU-bound encodes; an upload waiting behind
 * it is the operator watching a spinner. Bounded, because a chapter wedged in `processing`
 * must not stall the sweep forever.
 */
const yieldToPipeline = async (deps: ReapplyDeps): Promise<void> => {
  const sleep = deps.sleep ?? wait
  const poll = deps.yieldPollMs ?? 2_000
  const deadline = Date.now() + (deps.yieldTimeoutMs ?? 120_000)
  for (;;) {
    const [busy] = await deps.db
      .select({ n: count() })
      .from(chapters)
      .where(and(eq(chapters.state, 'processing'), isNull(chapters.deletedAt)))
    if ((busy?.n ?? 0) === 0) return
    if (Date.now() >= deadline) return
    await sleep(poll)
  }
}

/**
 * Run (or resume) one re-apply.
 *
 * Safe to call twice with the same id — a redelivered job, a restarted worker, the
 * scheduler picking a cold run back up: the second call either finds it finished or carries
 * on from the cursor the first left behind.
 */
export const runWatermarkReapply = async (
  runId: string,
  deps: ReapplyDeps,
): Promise<WatermarkRun | null> => {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const sleep = deps.sleep ?? wait
  const loaded = await readWatermarkRun(db)
  if (!loaded || loaded.id !== runId) {
    log.warn('watermark.reapply: no such run', { runId, found: loaded?.id ?? null })
    return loaded
  }
  if (loaded.status === 'done' || loaded.status === 'cancelled' || loaded.status === 'failed')
    return loaded

  let run: WatermarkRun = loaded
  /** Checkpoint. Only the keys in `patch` are written — see {@link patchWatermarkRun}. */
  const save = async (patch: Partial<WatermarkRun>): Promise<WatermarkRun> => {
    const next = { ...patch, updatedAt: now().toISOString() }
    run = { ...run, ...next }
    await patchWatermarkRun(db, runId, next)
    return run
  }
  const stop = (status: WatermarkRun['status'], error: string | null = null) =>
    save({ status, error, finishedAt: now().toISOString(), cancelRequested: false })

  const resolved = await resolveRunMark(db)
  if (!resolved.ok) {
    log.error('watermark.reapply refused: this host has no font to draw the mark', { runId })
    return stop('failed', resolved.error)
  }
  // The mark moved while this was queued or running. Half-applying two different marks
  // across one catalogue is worse than doing nothing, so stop and let the operator start a
  // fresh run against the settings they actually want.
  if (resolved.fingerprint !== run.fingerprint) {
    log.warn('watermark.reapply refused: the watermark changed since the run started', { runId })
    return stop('failed', 'settings_changed')
  }

  await save({
    status: 'running',
    error: null,
    heartbeatAt: now().toISOString(),
    // Recomputed rather than trusted: the panel seeds an estimate so a queued run has a
    // number to show, but the walk is the only thing that knows what it will actually visit.
    totals: { ...run.totals, chapters: run.totals.done + (await countCandidates(db, run)) },
  })
  log.info('watermark.reapply start', {
    runId,
    mark: run.fingerprint || '(none)',
    scope: run.scope ? `${run.scope.length} chapters` : 'catalogue',
    from: run.cursor,
    candidates: run.totals.chapters,
  })

  let handled = 0
  let dirtyCatalog = false
  const flushCatalog = async () => {
    if (!dirtyCatalog) return
    dirtyCatalog = false
    // The reader's chapter bundle is cached under the `catalog` tag, so re-pointed pages
    // would otherwise keep serving the old keys until the window expired.
    await revalidateWeb(['catalog'])
  }

  try {
    for (;;) {
      const batch = await nextCandidates(db, run)
      if (batch.length === 0) {
        await flushCatalog()
        log.info('watermark.reapply done', { runId, ...run.totals })
        return stop('done')
      }

      for (const chapterId of batch) {
        // Cancel and takeover are checked per chapter, not per batch: a catalogue-wide run
        // spends minutes on 25 chapters and Stop has to mean stop.
        const live = await readWatermarkRun(db)
        if (!live || live.id !== runId) {
          log.warn('watermark.reapply: the run row was replaced mid-run', { runId })
          await flushCatalog()
          return live
        }
        if (live.cancelRequested) {
          await flushCatalog()
          log.info('watermark.reapply cancelled', { runId, done: run.totals.done })
          return stop('cancelled')
        }
        if (deps.maxChapters !== undefined && handled >= deps.maxChapters) {
          await flushCatalog()
          // Left `running` with its cursor committed: exactly the state a killed worker
          // leaves behind, and the state a resume starts from.
          return save({ heartbeatAt: now().toISOString() })
        }

        await yieldToPipeline(deps)
        const outcome = await reapplyChapter(chapterId, resolved.mark, run.fingerprint, deps)
        handled += 1
        if (outcome.status === 'rewritten') dirtyCatalog = true

        const totals = { ...run.totals }
        totals.done += 1
        totals.pages += outcome.pages
        totals.orphanBytes += outcome.orphanBytes
        if (outcome.status === 'rewritten') totals.rewritten += 1
        else if (outcome.status === 'current') totals.alreadyCurrent += 1
        else totals.skipped += 1
        const problems =
          outcome.status === 'skipped'
            ? recordProblem(run.problems, {
                chapterId,
                seriesId: outcome.seriesId,
                number: outcome.number,
                reason: outcome.reason ?? 'failed',
                detail: outcome.detail,
              })
            : run.problems
        // Cursor and counters commit together, after the chapter's rows are already in
        // place. That is what makes the run resumable rather than merely restartable.
        await save({ cursor: chapterId, totals, problems, heartbeatAt: now().toISOString() })
        // Stop may have been pressed while this chapter was encoding. Checking again here
        // rather than only at the top of the next chapter is what makes Stop feel immediate
        // on a run whose chapters take a minute each.
        const asked = await readWatermarkRun(db)
        if (asked?.id === runId && asked.cancelRequested) {
          await flushCatalog()
          log.info('watermark.reapply cancelled', { runId, done: run.totals.done })
          return stop('cancelled')
        }
        if (outcome.status === 'skipped')
          log.warn('watermark.reapply skipped a chapter', {
            chapterId,
            reason: outcome.reason,
            detail: outcome.detail,
          })
        // Only throttle after real work. A chapter that was skipped or already correct cost
        // two indexed queries, and a catalogue with thousands of un-markable chapters would
        // otherwise spend hours asleep for no reason.
        const pause = outcome.status === 'rewritten' ? (deps.pauseMs ?? 250) : 0
        if (pause > 0) await sleep(pause)
      }
      await flushCatalog()
    }
  } catch (err) {
    log.error('watermark.reapply failed', err)
    return stop('failed', errorMessage(err))
  }
}
