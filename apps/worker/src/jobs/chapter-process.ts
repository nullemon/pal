import { MAX_ORIGINAL_BYTES, type Storage } from '@palscans/core/storage'
import {
  normalizeWatermark,
  WATERMARK_SETTING_KEY,
  type WatermarkConfig,
} from '@palscans/core/watermark'
import {
  type ChapterProcessing,
  chapterPages,
  chapters,
  type Db,
  getSetting,
  type PageVariant,
  type ProcessedPage,
  series,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import { processImage, watermarkFontAvailable } from '../lib/image.js'
import { log } from '../lib/log.js'
import { pool } from '../lib/pool.js'
import { revalidateWeb } from '../lib/revalidate.js'
import { notifyBookmarkers } from './publish.js'

export interface ProcessDeps {
  db: Db
  storage: Storage
  /** Pages processed at once inside one chapter (docs/03: ~4 on a 4-core box). */
  pageConcurrency?: number
  now?: () => Date
}

const errorMessage = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).slice(0, 300)

/**
 * The watermark this run will burn in (Admin → Appearance → Watermark).
 *
 * Read once per chapter, not once per page, so every page of one chapter carries the same
 * mark even if the operator saves a change while the job is running. A host with no font
 * installed would render an empty overlay and silently mark nothing while still changing
 * every content address, so a failed probe means the run proceeds unmarked and says so.
 */
export const watermarkFor = async (db: Db): Promise<WatermarkConfig | null> => {
  const config = normalizeWatermark(
    await getSetting<unknown>(db, WATERMARK_SETTING_KEY, null).catch(() => null),
  )
  if (!config.enabled) return null
  if (await watermarkFontAvailable()) return config
  log.warn('watermark skipped: no font available to render it', { text: config.text })
  return null
}

/**
 * `chapter.process` (docs/03): fetch every original, encode variants, write them under
 * content-addressed keys, then — only when every source succeeded — replace the
 * `chapter_pages` rows and flip the state to ready / scheduled / published. Any failure
 * leaves the chapter in `failed` with the per-page errors recorded; a retry may re-run only
 * the failed sources because successful results are kept in `processing.results`.
 */
export const processChapter = async (
  chapterId: number,
  deps: ProcessDeps,
): Promise<'done' | 'failed' | 'skipped'> => {
  const { db, storage } = deps
  const now = deps.now ?? (() => new Date())
  const [row] = await db
    .select({
      id: chapters.id,
      seriesId: chapters.seriesId,
      number: chapters.number,
      state: chapters.state,
      processing: chapters.processing,
      publishedAt: chapters.publishedAt,
      isPremium: chapters.isPremium,
    })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)
  if (!row?.processing || row.state !== 'processing') {
    log.warn('chapter.process skipped', { chapterId, state: row?.state ?? 'missing' })
    return 'skipped'
  }
  const doc: ChapterProcessing = {
    ...row.processing,
    errors: { ...row.processing.errors },
    results: { ...(row.processing.results ?? {}) },
  }
  const failedOnly = doc.mode === 'failed' && Object.keys(doc.errors).length > 0

  // failed-only: re-run the sources that errored, plus any without a kept result
  const todo = failedOnly
    ? doc.sources.filter(
        (s) => doc.errors[String(s.idx)] !== undefined || !doc.results?.[String(s.idx)],
      )
    : doc.sources
  if (!failedOnly) doc.results = {}
  doc.errors = failedOnly ? {} : {}
  doc.progress = {
    done: failedOnly ? doc.sources.length - todo.length : 0,
    total: doc.sources.length,
  }
  doc.startedAt = now().toISOString()
  doc.finishedAt = null
  const persist = async () => {
    await db
      .update(chapters)
      .set({ processing: doc, updatedAt: now() })
      .where(eq(chapters.id, chapterId))
  }
  await persist()
  log.info('chapter.process start', {
    chapterId,
    sources: doc.sources.length,
    todo: todo.length,
    failedOnly,
  })

  const prefix = `pages/${row.seriesId}/${chapterId}`
  const watermark = await watermarkFor(db)
  let dirty = false
  const flush = setInterval(() => {
    if (dirty) {
      dirty = false
      void persist()
    }
  }, 750)
  flush.unref()
  try {
    await pool(todo, deps.pageConcurrency ?? 4, async (source) => {
      try {
        // HEAD before GET: an oversized object (the browser PUT it straight to the store)
        // is skipped instead of being pulled into memory for sharp.
        const info = await storage.head(source.key)
        if (!info) throw new Error(`missing object ${source.key}`)
        if (info.size > MAX_ORIGINAL_BYTES)
          throw new Error(`source too large: ${info.size} bytes > ${MAX_ORIGINAL_BYTES}`)
        const original = await storage.get(source.key)
        if (!original) throw new Error(`missing object ${source.key}`)
        const encoded = await processImage(original, {
          prefix,
          startIdx: source.idx * 10,
          watermark,
        })
        const results: ProcessedPage[] = []
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
          results.push({
            key: largestWebp.key,
            width: page.width,
            height: page.height,
            bytes: largestWebp.bytes,
            blurHash: page.blurHash,
            variants,
          })
        }
        doc.results = { ...(doc.results ?? {}), [String(source.idx)]: results }
        delete doc.errors[String(source.idx)]
      } catch (err) {
        doc.errors[String(source.idx)] = errorMessage(err)
        log.warn('page failed', { chapterId, idx: source.idx, error: errorMessage(err) })
      } finally {
        doc.progress.done += 1
        dirty = true
      }
    })
  } finally {
    clearInterval(flush)
  }

  doc.finishedAt = now().toISOString()
  const failures = Object.keys(doc.errors).length
  if (failures > 0) {
    await db
      .update(chapters)
      .set({ state: 'failed', processing: doc, updatedAt: now() })
      .where(eq(chapters.id, chapterId))
    log.warn('chapter.process failed', { chapterId, failures })
    return 'failed'
  }

  // every source succeeded — rebuild the rows in display order (docs/03 "state machine is the guard")
  const rows: Array<typeof chapterPages.$inferInsert> = []
  for (const source of [...doc.sources].sort((a, b) => a.idx - b.idx)) {
    for (const r of doc.results?.[String(source.idx)] ?? []) {
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
    }
  }
  const at = now()
  const target = doc.after?.publishedAt ? new Date(doc.after.publishedAt) : row.publishedAt
  const nextState = target
    ? target.getTime() <= at.getTime()
      ? 'published'
      : 'scheduled'
    : 'ready'
  const lean: ChapterProcessing = { ...doc, results: undefined, mode: 'all' }
  await db.transaction(async (tx) => {
    await tx.delete(chapterPages).where(eq(chapterPages.chapterId, chapterId))
    if (rows.length) await tx.insert(chapterPages).values(rows)
    await tx
      .update(chapters)
      .set({
        pageCount: rows.length,
        state: nextState,
        publishedAt: target ?? null,
        isPremium: doc.after?.isPremium ?? row.isPremium,
        processing: lean,
        updatedAt: at,
      })
      .where(eq(chapters.id, chapterId))
    if (nextState === 'published') {
      await tx
        .update(series)
        .set({
          updatedAt: at,
        })
        .where(eq(series.id, row.seriesId))
      await notifyBookmarkers(tx, chapterId, row.seriesId, row.number)
    }
  })
  log.info('chapter.process done', { chapterId, pages: rows.length, state: nextState })
  if (nextState === 'published') await revalidateWeb(['catalog'])
  return 'done'
}
