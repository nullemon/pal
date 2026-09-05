import 'server-only'
import { getQueue } from '@palscans/core/queue'
import {
  normalizeWatermark,
  normalizeWatermarkRun,
  WATERMARK_REAPPLY_KEY,
  WATERMARK_SETTING_KEY,
  type WatermarkConfig,
  type WatermarkCounts,
  type WatermarkPageState,
  type WatermarkRun,
  watermarkFingerprint,
  watermarkRunLive,
} from '@palscans/core/watermark'
import { chapters, getDb, getSetting, mergeSetting, putSetting, settings } from '@palscans/db'
import { and, count, gt, isNull, type SQL, sql } from 'drizzle-orm'

export type { WatermarkCounts }

/**
 * Server side of "which chapters carry the current mark, and re-apply it to the ones that
 * do not" (docs/03 "Re-applying the mark").
 *
 * The worker owns the actual encoding — this only ever reads counters and writes the run
 * document that the worker treats as its checkpoint. Starting a run must never be a request
 * that waits: a catalogue-wide sweep is tens of thousands of images.
 */

/** A chapter still has originals to composite from. Without them nothing can re-mark it. */
const HAS_SOURCES: SQL = sql`(${chapters.processing} is not null and jsonb_array_length(coalesce(${chapters.processing} -> 'sources', '[]'::jsonb)) > 0)`
/** What the pipeline recorded burning into this chapter's pages; null before it recorded it. */
const RECORDED: SQL = sql`(${chapters.processing} ->> 'watermark')`

export const currentWatermark = async (): Promise<{
  config: WatermarkConfig
  fingerprint: string
}> => {
  const db = await getDb()
  const config = normalizeWatermark(
    await getSetting<unknown>(db, WATERMARK_SETTING_KEY, null).catch(() => null),
  )
  return { config, fingerprint: watermarkFingerprint(config) }
}

/**
 * How the catalogue stands against the mark configured now.
 *
 * The four buckets partition the processed chapters exactly, in the same priority order as
 * `watermarkPageState`, so the numbers on the screen always add up to `processed` and the
 * operator is never left wondering where the missing ones went.
 */
export const watermarkCounts = async (fingerprint: string): Promise<WatermarkCounts> => {
  const db = await getDb()
  const base = and(isNull(chapters.deletedAt), gt(chapters.pageCount, 0))
  const tally = async (extra?: SQL) => {
    const [row] = await db
      .select({ n: count() })
      .from(chapters)
      .where(extra ? and(base, extra) : base)
    return row?.n ?? 0
  }
  const [processed, current, stale, unknown, unmarkable] = await Promise.all([
    tally(),
    tally(sql`${HAS_SOURCES} and ${RECORDED} = ${fingerprint}`),
    tally(sql`${HAS_SOURCES} and ${RECORDED} is not null and ${RECORDED} <> ${fingerprint}`),
    tally(sql`${HAS_SOURCES} and ${RECORDED} is null`),
    tally(sql`not ${HAS_SOURCES}`),
  ])
  return { processed, current, stale, unknown, unmarkable, affected: stale + unknown }
}

export const readWatermarkRun = async (): Promise<WatermarkRun | null> =>
  normalizeWatermarkRun(
    await getSetting<unknown>(await getDb(), WATERMARK_REAPPLY_KEY, null).catch(() => null),
  )

export const writeWatermarkRun = async (run: WatermarkRun, userId: number | null) => {
  await putSetting(await getDb(), WATERMARK_REAPPLY_KEY, run, userId)
}

export class WatermarkRunBusyError extends Error {}

/**
 * Queue a run and return it. The document is written *before* the job is enqueued, so a
 * queue that drops the message still leaves a run the worker's scheduler picks up cold.
 */
export const startWatermarkRun = async (
  scope: number[] | null,
  userId: number | null,
): Promise<WatermarkRun> => {
  const live = await readWatermarkRun()
  if (watermarkRunLive(live)) throw new WatermarkRunBusyError('a re-apply is already running')
  const { config, fingerprint } = await currentWatermark()
  const at = new Date().toISOString()
  // A queued run has a number to show before the worker reaches it. It is an estimate: the
  // walk recounts when it starts, which is the figure the progress bar settles on.
  const estimate = scope?.length ?? (await watermarkCounts(fingerprint)).affected
  const run: WatermarkRun = {
    id: `wm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'queued',
    fingerprint,
    label: config.enabled ? config.text : '',
    scope: scope && scope.length > 0 ? [...new Set(scope)].sort((a, b) => a - b) : null,
    cursor: 0,
    totals: {
      chapters: estimate,
      done: 0,
      rewritten: 0,
      alreadyCurrent: 0,
      skipped: 0,
      pages: 0,
      orphanBytes: 0,
    },
    problems: [],
    cancelRequested: false,
    startedBy: userId,
    startedAt: at,
    updatedAt: at,
    heartbeatAt: null,
    finishedAt: null,
    error: null,
  }
  await writeWatermarkRun(run, userId)
  try {
    const queue = await getQueue()
    await queue.add(
      'watermark.reapply',
      { runId: run.id },
      { jobId: `watermark.reapply:${run.id}` },
    )
  } catch {
    // The worker's scheduler picks up a live run whose heartbeat never arrived, so a queue
    // that is down delays the sweep rather than losing it.
  }
  return run
}

/**
 * Ask a run to stop. The worker reads the flag between chapters, which is what keeps a
 * cancel from leaving one chapter half-rewritten. A run nothing ever picked up is closed
 * here instead, so Stop always means something.
 */
export const cancelWatermarkRun = async (userId: number | null): Promise<WatermarkRun | null> => {
  const run = await readWatermarkRun()
  if (!run || !watermarkRunLive(run)) return run
  const at = new Date().toISOString()
  const db = await getDb()
  // A run nothing has picked up yet is closed here; anything else gets the flag and stops
  // itself. Either way the write touches *only* these keys: the worker is checkpointing its
  // cursor into the same row, and writing the document whole from here would undo it.
  const patch =
    run.status === 'queued' && !run.heartbeatAt
      ? { status: 'cancelled' as const, cancelRequested: false, finishedAt: at, updatedAt: at }
      : { cancelRequested: true, updatedAt: at }
  await mergeSetting(
    db,
    WATERMARK_REAPPLY_KEY,
    patch,
    sql`(${settings.value} ->> 'id') = ${run.id}`,
    userId,
  )
  return { ...run, ...patch }
}

/** Per-chapter state for the admin tables, in the same priority order as the counts above. */
export const watermarkStateSql = (fingerprint: string): SQL<WatermarkPageState> =>
  sql<WatermarkPageState>`case
    when ${chapters.pageCount} <= 0 then 'unprocessed'
    when not ${HAS_SOURCES} then 'unmarkable'
    when ${RECORDED} is null then 'unknown'
    when ${RECORDED} = ${fingerprint} then 'current'
    else 'stale'
  end`

/** The filter behind Chapters → Mark, so an operator never has to run SQL to find the gap. */
export const watermarkStateFilter = (
  fingerprint: string,
  state: 'current' | 'stale' | 'unknown' | 'unmarkable',
): SQL => {
  if (state === 'unmarkable') return sql`(${chapters.pageCount} > 0 and not ${HAS_SOURCES})`
  if (state === 'unknown')
    return sql`(${chapters.pageCount} > 0 and ${HAS_SOURCES} and ${RECORDED} is null)`
  if (state === 'current')
    return sql`(${chapters.pageCount} > 0 and ${HAS_SOURCES} and ${RECORDED} = ${fingerprint})`
  return sql`(${chapters.pageCount} > 0 and ${HAS_SOURCES} and ${RECORDED} is not null and ${RECORDED} <> ${fingerprint})`
}
