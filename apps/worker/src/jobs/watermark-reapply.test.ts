import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FsStorage } from '@palscans/core'
import type { Storage } from '@palscans/core/storage'
import {
  normalizeWatermark,
  WATERMARK_REAPPLY_KEY,
  WATERMARK_SETTING_KEY,
  type WatermarkConfig,
  type WatermarkRun,
  watermarkFingerprint,
} from '@palscans/core/watermark'
import {
  type ChapterSource,
  chapterPages,
  chapters,
  createDb,
  type Db,
  type DbHandle,
  mergeSetting,
  putSetting,
  runMigrations,
  series,
  settings,
} from '@palscans/db'
import { asc, eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { processChapter } from './chapter-process.js'
import {
  patchWatermarkRun,
  readWatermarkRun,
  reapplyChapter,
  runWatermarkReapply,
} from './watermark-reapply.js'

/**
 * The three things that would be unrecoverable if this job were wrong, checked against a
 * real Postgres and real image bytes rather than asserted:
 *
 * 1. A page that already carries the mark is never marked a second time. The proof is
 *    structural — the job reads only `uploads/`, and the bytes it writes are the bytes you
 *    get by processing the *original* — and it is asserted both ways round.
 * 2. A chapter whose originals have gone is reported, and comes out of the run byte-for-byte
 *    as it went in.
 * 3. A run that is interrupted resumes to the same place an uninterrupted one reaches.
 */

/** The host's font decides whether the mark can be drawn at all; the run refuses without one. */
const font = vi.hoisted(() => ({ available: true }))
vi.mock('../lib/image.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/image.js')>()
  return { ...actual, watermarkFontAvailable: async () => font.available }
})

let dir: string
let handle: DbHandle
let db: Db
let storageDir: string
let storage: Storage
/** Every key the job asked storage for, so "it never reads a page object" is a test, not a claim. */
let reads: string[]

const MARK_A: WatermarkConfig = normalizeWatermark({ enabled: true, text: 'palscans.org' })
const MARK_B: WatermarkConfig = normalizeWatermark({
  enabled: true,
  text: 'palscans.org',
  corner: 'bottom-left',
  scale: 3.4,
})

/**
 * Deliberately just over 480px wide: the pipeline emits a single variant width for it, which
 * keeps a suite that encodes real AVIF and WebP honest without making it the slowest thing
 * in the repo.
 */
const artwork = (seed: number) =>
  sharp({
    create: {
      width: 520,
      height: 760,
      channels: 3,
      background: { r: 20 + seed * 7, g: 30, b: 90 },
    },
  })
    .jpeg({ quality: 82 })
    .toBuffer()

/** A storage wrapper that records reads. The driver underneath is the real fs one. */
const spyStorage = (inner: Storage): Storage =>
  new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'get')
        return async (key: string) => {
          reads.push(key)
          return inner.get(key)
        }
      return Reflect.get(target, prop, receiver)
    },
  })

const deps = () => ({
  db,
  storage,
  pageConcurrency: 2,
  pauseMs: 0,
  yieldPollMs: 1,
  yieldTimeoutMs: 0,
})

const setMark = async (config: WatermarkConfig | { enabled: false }) => {
  await putSetting(db, WATERMARK_SETTING_KEY, config)
}

/** Create a chapter with real uploaded originals and run the pipeline over it. */
const seedChapter = async (opts: {
  seriesId: number
  number: number
  pages: number
}): Promise<number> => {
  const [row] = await db
    .insert(chapters)
    .values({ seriesId: opts.seriesId, number: opts.number, state: 'processing' })
    .returning({ id: chapters.id })
  if (!row) throw new Error('no chapter')
  const sources: ChapterSource[] = []
  for (let i = 0; i < opts.pages; i++) {
    const bytes = await artwork(i + opts.number)
    const key = `uploads/${opts.seriesId}/${row.id}/${String(i).padStart(4, '0')}-abcdef012345.jpg`
    await storage.put(key, bytes, { contentType: 'image/jpeg' })
    sources.push({ idx: i, key, bytes: bytes.byteLength, sha256: 'x'.repeat(64) })
  }
  await db
    .update(chapters)
    .set({
      processing: {
        sources,
        progress: { done: 0, total: sources.length },
        errors: {},
        attempt: 0,
        mode: 'all',
        startedAt: null,
        finishedAt: null,
      },
    })
    .where(eq(chapters.id, row.id))
  const outcome = await processChapter(row.id, { db, storage, pageConcurrency: 2 })
  expect(outcome).toBe('done')
  return row.id
}

const pagesOf = async (chapterId: number) =>
  db
    .select({ idx: chapterPages.idx, key: chapterPages.key, variants: chapterPages.variants })
    .from(chapterPages)
    .where(eq(chapterPages.chapterId, chapterId))
    .orderBy(asc(chapterPages.idx))

const processingOf = async (chapterId: number) => {
  const [row] = await db
    .select({ processing: chapters.processing, pageCount: chapters.pageCount })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)
  return row
}

/** Blank the recorded fingerprint: what every chapter processed before this feature looks like. */
const forgetFingerprint = async (chapterId: number) => {
  const row = await processingOf(chapterId)
  if (!row?.processing) throw new Error('no processing doc')
  const { watermark: _drop, ...rest } = row.processing
  await db.update(chapters).set({ processing: rest }).where(eq(chapters.id, chapterId))
}

const startRun = async (over: Partial<WatermarkRun> = {}): Promise<string> => {
  const at = new Date().toISOString()
  const config = normalizeWatermark(
    (await db.select().from(settings).where(eq(settings.key, WATERMARK_SETTING_KEY)).limit(1))[0]
      ?.value,
  )
  const run: WatermarkRun = {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    status: 'queued',
    fingerprint: watermarkFingerprint(config),
    label: config.enabled ? config.text : '',
    scope: null,
    cursor: 0,
    totals: {
      chapters: 0,
      done: 0,
      rewritten: 0,
      alreadyCurrent: 0,
      skipped: 0,
      pages: 0,
      orphanBytes: 0,
    },
    problems: [],
    cancelRequested: false,
    startedBy: null,
    startedAt: at,
    updatedAt: at,
    heartbeatAt: null,
    finishedAt: null,
    error: null,
    ...over,
  }
  await putSetting(db, WATERMARK_REAPPLY_KEY, run)
  return run.id
}

let seriesId: number

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-wm-'))
  storageDir = path.join(dir, 'storage')
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  storage = spyStorage(new FsStorage({ root: storageDir, publicUrl: '/_storage' }))
  const [s] = await db
    .insert(series)
    .values({ slug: 'wm-test', title: 'Watermark test', type: 'manga' })
    .returning({ id: series.id })
  if (!s) throw new Error('no series')
  seriesId = s.id
}, 120_000)

afterAll(async () => {
  await handle?.close()
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  reads = []
  font.available = true
  await db.delete(settings)
})

describe('re-applying the watermark', () => {
  it('never marks a page that already carries the current mark, and never reads a page object', async () => {
    await setMark(MARK_A)
    const chapterId = await seedChapter({ seriesId, number: 1, pages: 2 })
    const before = await pagesOf(chapterId)
    const beforeBytes = await storage.get(before[0]?.key ?? '')
    expect(before.length).toBe(2)
    // The pipeline records what it burned in, which is what makes the panel's column cheap.
    expect((await processingOf(chapterId))?.processing?.watermark).toBe(
      watermarkFingerprint(MARK_A),
    )

    // A chapter processed before the fingerprint existed: the run cannot trust a flag, so it
    // re-derives the address from the original and proves the pages are already right.
    await forgetFingerprint(chapterId)
    reads = []
    const runId = await startRun({ scope: [chapterId] })
    await runWatermarkReapply(runId, deps())
    // Snapshot before the assertions below start reading page objects themselves.
    const jobReads = [...reads]
    const run = await readWatermarkRun(db)
    expect(run?.status).toBe('done')
    expect(run?.totals.alreadyCurrent).toBe(1)
    expect(run?.totals.rewritten).toBe(0)

    // Same keys, same bytes: nothing was composited on top of an already-marked image.
    const after = await pagesOf(chapterId)
    expect(after.map((p) => p.key)).toEqual(before.map((p) => p.key))
    expect(Buffer.from((await storage.get(after[0]?.key ?? '')) ?? [])).toEqual(
      Buffer.from(beforeBytes ?? []),
    )
    // …and the fingerprint is settled, so the next run skips it in SQL.
    expect((await processingOf(chapterId))?.processing?.watermark).toBe(
      watermarkFingerprint(MARK_A),
    )
    // The structural guarantee: every byte the job read came from an upload.
    expect(jobReads.length).toBeGreaterThan(0)
    expect(jobReads.filter((k) => !k.startsWith('uploads/'))).toEqual([])
  }, 120_000)

  it('rebuilds a changed mark from the original, not from the marked page', async () => {
    await setMark(MARK_A)
    const chapterId = await seedChapter({ seriesId, number: 2, pages: 1 })
    const before = await pagesOf(chapterId)
    const markedUnderA = Buffer.from((await storage.get(before[0]?.key ?? '')) ?? [])

    await setMark(MARK_B)
    const runId = await startRun({ scope: [chapterId] })
    await runWatermarkReapply(runId, deps())
    expect((await readWatermarkRun(db))?.totals.rewritten).toBe(1)

    const after = await pagesOf(chapterId)
    expect(after.map((p) => p.key)).not.toEqual(before.map((p) => p.key))
    const got = Buffer.from((await storage.get(after[0]?.key ?? '')) ?? [])

    // What it *should* be: the original processed once under B.
    const original = (await processingOf(chapterId))?.processing?.sources[0]?.key
    expect(original?.startsWith('uploads/')).toBe(true)
    const { processImage } = await import('../lib/image.js')
    const fromOriginal = await processImage(
      (await storage.get(original ?? '')) ?? new Uint8Array(),
      {
        prefix: `pages/${seriesId}/${chapterId}`,
        startIdx: 0,
        watermark: MARK_B,
      },
    )
    const wantWebp = [...(fromOriginal[0]?.variants ?? [])]
      .filter((v) => v.fmt === 'webp')
      .sort((a, b) => b.w - a.w)[0]
    expect(got).toEqual(wantWebp?.data)

    // What it must never be: the already-marked page processed again under B.
    const doubled = await processImage(markedUnderA, {
      prefix: `pages/${seriesId}/${chapterId}`,
      startIdx: 0,
      watermark: MARK_B,
    })
    const doubledWebp = [...(doubled[0]?.variants ?? [])]
      .filter((v) => v.fmt === 'webp')
      .sort((a, b) => b.w - a.w)[0]
    expect(got).not.toEqual(doubledWebp?.data)

    // The superseded objects are left where they are — see docs/03 on why they are not swept.
    expect(await storage.exists(before[0]?.key ?? '')).toBe(true)
    expect((await readWatermarkRun(db))?.totals.orphanBytes).toBeGreaterThan(0)
  }, 180_000)

  it('reports a chapter whose originals are gone instead of touching it', async () => {
    await setMark(MARK_A)
    const chapterId = await seedChapter({ seriesId, number: 3, pages: 2 })
    const before = await pagesOf(chapterId)
    const sources = (await processingOf(chapterId))?.processing?.sources ?? []
    await storage.delete(sources[1]?.key ?? '')

    await setMark(MARK_B)
    const runId = await startRun({ scope: [chapterId] })
    await runWatermarkReapply(runId, deps())
    const run = await readWatermarkRun(db)
    expect(run?.status).toBe('done')
    expect(run?.totals.skipped).toBe(1)
    expect(run?.totals.rewritten).toBe(0)
    const problem = run?.problems.find((p) => p.chapterId === chapterId)
    expect(problem?.reason).toBe('missing_originals')
    expect(problem?.detail).toContain('1 of 2')

    // Untouched: same rows, same keys, same recorded mark. Nothing half-written.
    const after = await pagesOf(chapterId)
    expect(after).toEqual(before)
    expect((await processingOf(chapterId))?.processing?.watermark).toBe(
      watermarkFingerprint(MARK_A),
    )
  }, 120_000)

  it('refuses a chapter whose sources point outside uploads/', async () => {
    await setMark(MARK_A)
    const chapterId = await seedChapter({ seriesId, number: 4, pages: 1 })
    const row = await processingOf(chapterId)
    const pages = await pagesOf(chapterId)
    // The one shape that could double-mark: a processed page offered up as an original.
    await db
      .update(chapters)
      .set({
        processing: {
          ...(row?.processing ?? { progress: { done: 0, total: 0 }, errors: {}, attempt: 0 }),
          sources: [{ idx: 0, key: pages[0]?.key ?? '', bytes: 1, sha256: 'y'.repeat(64) }],
        } as NonNullable<typeof row>['processing'],
      })
      .where(eq(chapters.id, chapterId))

    const outcome = await reapplyChapter(chapterId, MARK_B, watermarkFingerprint(MARK_B), deps())
    expect(outcome.status).toBe('skipped')
    expect(outcome.reason).toBe('foreign_sources')
    expect(await pagesOf(chapterId)).toEqual(pages)
  }, 120_000)

  it('resumes an interrupted run where it stopped', async () => {
    await setMark(MARK_A)
    const a = await seedChapter({ seriesId, number: 5, pages: 1 })
    const b = await seedChapter({ seriesId, number: 6, pages: 1 })
    await setMark(MARK_B)

    const runId = await startRun({ scope: [a, b] })
    // One chapter, then the worker "dies": the run is left running with its cursor committed.
    await runWatermarkReapply(runId, { ...deps(), maxChapters: 1 })
    const half = await readWatermarkRun(db)
    expect(half?.status).toBe('running')
    expect(half?.totals.done).toBe(1)
    expect(half?.cursor).toBe(a)
    expect((await processingOf(a))?.processing?.watermark).toBe(watermarkFingerprint(MARK_B))
    expect((await processingOf(b))?.processing?.watermark).toBe(watermarkFingerprint(MARK_A))

    // The same run id, picked back up: it carries on rather than starting over.
    await runWatermarkReapply(runId, deps())
    const done = await readWatermarkRun(db)
    expect(done?.status).toBe('done')
    expect(done?.totals.done).toBe(2)
    expect(done?.totals.rewritten).toBe(2)
    expect((await processingOf(b))?.processing?.watermark).toBe(watermarkFingerprint(MARK_B))
  }, 240_000)

  it('stops between chapters when cancelled, leaving the rest untouched', async () => {
    await setMark(MARK_A)
    const a = await seedChapter({ seriesId, number: 7, pages: 1 })
    const b = await seedChapter({ seriesId, number: 8, pages: 1 })
    await setMark(MARK_B)
    const runId = await startRun({ scope: [a, b], cancelRequested: true, cursor: 0 })
    await runWatermarkReapply(runId, deps())
    const run = await readWatermarkRun(db)
    expect(run?.status).toBe('cancelled')
    expect(run?.totals.done).toBe(0)
    for (const id of [a, b])
      expect((await processingOf(id))?.processing?.watermark).toBe(watermarkFingerprint(MARK_A))
  }, 120_000)

  it('a checkpoint never throws away a Stop that arrived while a chapter was encoding', async () => {
    // The panel and the worker write the same document. Before both writes became merges,
    // the checkpoint after a chapter wrote the runner's stale `cancelRequested: false` back
    // over the operator's Stop, and the run carried on to the end of the catalogue.
    await setMark(MARK_A)
    const runId = await startRun()
    await mergeSetting(
      db,
      WATERMARK_REAPPLY_KEY,
      { cancelRequested: true },
      sql`(${settings.value} ->> 'id') = ${runId}`,
    )
    await patchWatermarkRun(db, runId, { cursor: 99, heartbeatAt: new Date().toISOString() })
    const after = await readWatermarkRun(db)
    expect(after?.cursor).toBe(99)
    expect(after?.cancelRequested).toBe(true)
  })

  it('stops after the chapter in hand when Stop arrives mid-run', async () => {
    await setMark(MARK_A)
    const a = await seedChapter({ seriesId, number: 12, pages: 1 })
    const b = await seedChapter({ seriesId, number: 13, pages: 1 })
    await setMark(MARK_B)
    const runId = await startRun({ scope: [a, b] })
    // The operator presses Stop while the first chapter is being encoded.
    const sleep = async () => {
      await mergeSetting(
        db,
        WATERMARK_REAPPLY_KEY,
        { cancelRequested: true },
        sql`(${settings.value} ->> 'id') = ${runId}`,
      )
    }
    await runWatermarkReapply(runId, { ...deps(), pauseMs: 1, sleep })
    const run = await readWatermarkRun(db)
    expect(run?.status).toBe('cancelled')
    expect(run?.totals.done).toBe(1)
    expect(run?.totals.rewritten).toBe(1)
    // The chapter it finished keeps its new mark; the one it never reached is untouched.
    expect((await processingOf(a))?.processing?.watermark).toBe(watermarkFingerprint(MARK_B))
    expect((await processingOf(b))?.processing?.watermark).toBe(watermarkFingerprint(MARK_A))
  }, 180_000)

  it('answers for every chapter a selection names, and leaves unmarkable ones out of a sweep', async () => {
    await setMark(MARK_A)
    const done = await seedChapter({ seriesId, number: 14, pages: 1 })
    // A chapter with pages but no originals at all — an import, or a bucket someone tidied.
    const [orphan] = await db
      .insert(chapters)
      .values({ seriesId, number: 15, state: 'published', pageCount: 1 })
      .returning({ id: chapters.id })
    if (!orphan) throw new Error('no chapter')
    await db.insert(chapterPages).values({
      chapterId: orphan.id,
      idx: 0,
      key: 'pages/x/y/0000-aaa.1080.webp',
      width: 1,
      height: 1,
      bytes: 1,
    })

    // Named explicitly: both get an outcome, including the one nothing can ever fix.
    await runWatermarkReapply(await startRun({ scope: [done, orphan.id] }), deps())
    const selection = await readWatermarkRun(db)
    expect(selection?.totals.done).toBe(2)
    expect(selection?.totals.alreadyCurrent).toBe(1)
    expect(selection?.problems.map((p) => [p.chapterId, p.reason])).toEqual([
      [orphan.id, 'no_sources'],
    ])

    // A catalogue sweep never visits it: the panel's column reports those permanently, and a
    // sweep that walked them would fill its report with the one thing it cannot act on.
    await runWatermarkReapply(await startRun(), deps())
    const sweep = await readWatermarkRun(db)
    expect(sweep?.problems.some((p) => p.chapterId === orphan.id)).toBe(false)
    await db.delete(chapterPages).where(eq(chapterPages.chapterId, orphan.id))
    await db.delete(chapters).where(eq(chapters.id, orphan.id))
  }, 180_000)

  it('refuses to run at all when the host cannot draw the mark', async () => {
    await setMark(MARK_A)
    const chapterId = await seedChapter({ seriesId, number: 9, pages: 1 })
    const before = await pagesOf(chapterId)
    await setMark(MARK_B)
    font.available = false
    const runId = await startRun({ scope: [chapterId] })
    await runWatermarkReapply(runId, deps())
    const run = await readWatermarkRun(db)
    expect(run?.status).toBe('failed')
    expect(run?.error).toBe('no_font')
    // Crucially: it did not sweep the catalogue clean of marks and call that success.
    expect(await pagesOf(chapterId)).toEqual(before)
  }, 120_000)

  it('stops rather than half-applying two marks when the settings move mid-run', async () => {
    await setMark(MARK_A)
    const chapterId = await seedChapter({ seriesId, number: 10, pages: 1 })
    const before = await pagesOf(chapterId)
    await setMark(MARK_B)
    const runId = await startRun({ scope: [chapterId] })
    // The operator saves again while the job is still queued.
    await setMark(MARK_A)
    await runWatermarkReapply(runId, deps())
    const run = await readWatermarkRun(db)
    expect(run?.status).toBe('failed')
    expect(run?.error).toBe('settings_changed')
    expect(await pagesOf(chapterId)).toEqual(before)
  }, 120_000)

  it('turning the mark off restores the unmarked originals byte for byte', async () => {
    await setMark({ enabled: false })
    const chapterId = await seedChapter({ seriesId, number: 11, pages: 1 })
    const bare = await pagesOf(chapterId)
    const bareBytes = Buffer.from((await storage.get(bare[0]?.key ?? '')) ?? [])

    await setMark(MARK_A)
    await runWatermarkReapply(await startRun({ scope: [chapterId] }), deps())
    const marked = await pagesOf(chapterId)
    expect(marked[0]?.key).not.toBe(bare[0]?.key)

    await setMark({ enabled: false })
    await runWatermarkReapply(await startRun({ scope: [chapterId] }), deps())
    const back = await pagesOf(chapterId)
    // Content addressing means "off" is the same address it always had, not a third one.
    expect(back.map((p) => p.key)).toEqual(bare.map((p) => p.key))
    expect(Buffer.from((await storage.get(back[0]?.key ?? '')) ?? [])).toEqual(bareBytes)
  }, 180_000)
})
