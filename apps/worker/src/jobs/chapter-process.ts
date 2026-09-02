import type { Storage } from '@palscans/core/storage'
import {
  type ChapterProcessing,
  chapterPages,
  chapters,
  type Db,
  type PageVariant,
  type ProcessedPage,
  series,
} from '@palscans/db'
import { eq, sql } from 'drizzle-orm'
import { processImage } from '../lib/image.js'
import { log } from '../lib/log.js'
import { pool } from '../lib/pool.js'
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
        const original = await storage.get(source.key)
        if (!original) throw new Error(`missing object ${source.key}`)
        const encoded = await processImage(original, { prefix, startIdx: source.idx * 10 })
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
          lastChapterAt: sql`greatest(coalesce(${series.lastChapterAt}, ${at.toISOString()}::timestamptz), ${at.toISOString()}::timestamptz)`,
          updatedAt: at,
        })
        .where(eq(series.id, row.seriesId))
      await notifyBookmarkers(tx, chapterId, row.seriesId, row.number)
    }
  })
  log.info('chapter.process done', { chapterId, pages: rows.length, state: nextState })
  return 'done'
}
