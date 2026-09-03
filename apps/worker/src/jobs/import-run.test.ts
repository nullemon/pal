import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FsStorage } from '@palscans/core'
import type { LegacyPageImage } from '@palscans/core/import'
import { createFixtureSource, legacyDumpSql } from '@palscans/core/import/fixtures'
import { createDumpSourceFromSetting } from '@palscans/core/import/sources'
import { MemoryQueue } from '@palscans/core/queue'
import {
  chapterPages,
  chapters,
  comments,
  createDb,
  type Db,
  type DbHandle,
  importMap,
  importRuns,
  redirects,
  runMigrations,
  series,
  users,
} from '@palscans/db'
import { eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { processChapter } from './chapter-process.js'
import { runImport } from './import-run.js'

/**
 * The importer's two load-bearing promises, checked against a real Postgres (PGlite) rather
 * than asserted: a second run changes nothing, and a run interrupted mid-way resumes to the
 * same result as one that was never interrupted.
 */

let dir: string
let handle: DbHandle
let db: Db
let storageDir: string

const depsFor = (overrides: Partial<Parameters<typeof runImport>[1]> = {}) => ({
  db,
  storage: new FsStorage({ root: storageDir, publicUrl: '/_storage' }),
  queue: new MemoryQueue('import-test'),
  source: createFixtureSource(),
  batchSize: 5,
  skipImages: false,
  ...overrides,
})

const startRun = async (): Promise<number> => {
  const [row] = await db
    .insert(importRuns)
    .values({ source: 'fixture', config: {}, status: 'queued' })
    .returning({ id: importRuns.id })
  if (!row) throw new Error('no run row')
  return row.id
}

const clearRuns = async (): Promise<void> => {
  await db.delete(importRuns)
}

const snapshot = async () => {
  const count = async (table: Parameters<typeof db.$count>[0]) => Number(await db.$count(table))
  return {
    series: await count(series),
    chapters: await count(chapters),
    users: await count(users),
    comments: await count(comments),
    redirects: await count(redirects),
    mappings: await count(importMap),
  }
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-import-'))
  storageDir = path.join(dir, 'storage')
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
}, 120_000)

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

describe('runImport', () => {
  it('imports the sample catalogue end to end', async () => {
    const runId = await startRun()
    const status = await runImport(runId, depsFor())
    expect(status).toBe('done')

    const [row] = await db.select().from(importRuns).where(eq(importRuns.id, runId))
    expect(row?.phase).toBe('done')
    expect(row?.finishedAt).not.toBeNull()

    const after = await snapshot()
    expect(after.series).toBeGreaterThan(0)
    expect(after.chapters).toBeGreaterThan(0)
    expect(after.users).toBeGreaterThan(0)
    expect(after.redirects).toBeGreaterThan(0)
    // Every series and chapter it wrote is keyed for the next run.
    expect(after.mappings).toBeGreaterThanOrEqual(after.series + after.chapters)
    expect(row?.counts.series).toBe(after.series)
  }, 120_000)

  it('is idempotent: a second run writes nothing new', async () => {
    const before = await snapshot()
    await clearRuns()
    const runId = await startRun()
    expect(await runImport(runId, depsFor())).toBe('done')

    const [row] = await db.select().from(importRuns).where(eq(importRuns.id, runId))
    expect(row?.counts.series ?? 0).toBe(0)
    expect(row?.counts.chapters ?? 0).toBe(0)
    expect(row?.counts.skipped ?? 0).toBeGreaterThan(0)
    // The catalogue is untouched — no duplicate rows, no re-created redirects.
    expect(await snapshot()).toEqual(before)
  }, 120_000)

  it('pauses between batches and resumes to the same result', async () => {
    // Start from an empty catalogue so the resumed run has real work on both sides of the stop.
    await db.execute(
      sql`truncate table ${series}, ${users}, ${comments}, ${redirects}, ${importMap}, ${importRuns} restart identity cascade`,
    )
    const complete = await (async () => {
      const runId = await startRun()
      expect(await runImport(runId, depsFor())).toBe('done')
      const snap = await snapshot()
      await db.execute(
        sql`truncate table ${series}, ${users}, ${comments}, ${redirects}, ${importMap}, ${importRuns} restart identity cascade`,
      )
      return snap
    })()

    const runId = await startRun()
    // Ask for a pause a few batches in; the runner checks the flag between batches only, so
    // the stop must land on a committed checkpoint.
    let ticks = 0
    const paused = await runImport(
      runId,
      depsFor({
        now: () => {
          ticks += 1
          if (ticks === 6)
            void db
              .update(importRuns)
              .set({ pauseRequested: true })
              .where(eq(importRuns.id, runId))
              .then()
          return new Date()
        },
      }),
    )
    expect(paused).toBe('paused')
    const [mid] = await db.select().from(importRuns).where(eq(importRuns.id, runId))
    expect(mid?.finishedAt).toBeNull()
    expect(mid?.phase).not.toBe('done')
    // The stop has to land in the middle of real work, or resuming proves nothing: some rows
    // are already written, and fewer than a complete run would leave.
    const partial = await snapshot()
    expect(partial.mappings).toBeGreaterThan(0)
    expect(partial.mappings).toBeLessThan(complete.mappings)

    // A fresh process resumes from the stored cursor — new streams, cold fast-forward.
    expect(await runImport(runId, depsFor())).toBe('done')
    expect(await snapshot()).toEqual({ ...complete, mappings: complete.mappings })
  }, 180_000)
})

describe('page handoff', () => {
  it('stages originals that the normal chapter pipeline can process', async () => {
    // The shipped fixture's page bytes are a 4-byte placeholder, which sharp rightly refuses.
    // Swapping in a real image proves the seam the importer actually owns: originals land in
    // storage under the upload prefix, and `chapter.process` takes them the rest of the way.
    const real = await sharp({
      create: { width: 64, height: 96, channels: 3, background: { r: 20, g: 10, b: 40 } },
    })
      .jpeg()
      .toBuffer()
    const source = createFixtureSource()
    const withRealPages = {
      ...source,
      readPage: async (): Promise<LegacyPageImage> => ({
        filename: 'page.jpg',
        bytes: new Uint8Array(real),
        contentType: 'image/jpeg',
      }),
    }

    await db.execute(
      sql`truncate table ${series}, ${users}, ${comments}, ${redirects}, ${importMap}, ${importRuns} restart identity cascade`,
    )
    const storage = new FsStorage({ root: storageDir, publicUrl: '/_storage' })
    const runId = await startRun()
    expect(await runImport(runId, depsFor({ source: withRealPages, storage }))).toBe('done')

    const [chapter] = await db
      .select({ id: chapters.id, state: chapters.state })
      .from(chapters)
      .where(eq(chapters.state, 'processing'))
      .limit(1)
    expect(chapter).toBeDefined()
    if (!chapter) return

    // Every original the importer wrote is readable back from storage under the upload prefix.
    const staged = await storage.list('uploads/')
    expect(staged.length).toBeGreaterThan(0)

    expect(await processChapter(chapter.id, { db, storage })).toBe('done')
    const [after] = await db
      .select({ state: chapters.state, pageCount: chapters.pageCount })
      .from(chapters)
      .where(eq(chapters.id, chapter.id))
    expect(after?.state).toBe('published')
    expect(after?.pageCount).toBeGreaterThan(0)
    expect(Number(await db.$count(chapterPages))).toBeGreaterThan(0)
  }, 180_000)
})

describe('the mysqldump connector', () => {
  it('imports from a dump file exactly as the sample source does', async () => {
    // The seam this covers is the wiring, not the parser (that has its own tests in
    // @palscans/core): a stored `mode: 'dump'` config resolves to a real adapter, and the
    // runner cannot tell it apart from the in-memory one.
    const dumpPath = path.join(dir, 'legacy.sql')
    await writeFile(dumpPath, legacyDumpSql(), 'utf8')

    const fresh = async () => {
      await db.execute(
        sql`truncate table ${series}, ${users}, ${comments}, ${redirects}, ${importMap}, ${importRuns} restart identity cascade`,
      )
      return startRun()
    }

    let runId = await fresh()
    expect(await runImport(runId, depsFor({ skipImages: true }))).toBe('done')
    const viaSample = await snapshot()

    runId = await fresh()
    const dumpSource = createDumpSourceFromSetting({
      mode: 'dump',
      dsn: '',
      dumpPath,
      tablePrefix: 'wp_',
      uploadsMode: 'path',
      uploadsPath: '',
      uploadsArchive: '',
      batchSize: 5,
      skipImages: true,
    })
    expect(await runImport(runId, depsFor({ source: dumpSource, skipImages: true }))).toBe('done')

    expect(await snapshot()).toEqual(viaSample)
  }, 180_000)
})

describe('every series gets its chapters', () => {
  it('does not skip a series when the previous one runs out of chapters', async () => {
    // Regression test. The chapter phase walks one series at a time; when a series ran out it
    // advanced the stream *and* checkpointed the next series, and the following batch then
    // asked for another one — so every other series was skipped and the run still reported
    // `done`. The old assertion (`chapters > 0`) could not see it, because the surviving
    // series still imported theirs.
    await db.execute(
      sql`truncate table ${series}, ${users}, ${comments}, ${redirects}, ${importMap}, ${importRuns} restart identity cascade`,
    )
    const runId = await startRun()
    expect(await runImport(runId, depsFor({ skipImages: true, batchSize: 5 }))).toBe('done')

    // The fixture spreads chapters over four legacy posts. Every one of them that has a
    // parsable chapter must end up with chapters against its own series row.
    const rows = await db
      .select({ seriesId: chapters.seriesId })
      .from(chapters)
      .groupBy(chapters.seriesId)
    expect(rows.length).toBe(4)

    const mapped = await db
      .select({ kind: importMap.kind, legacyId: importMap.legacyId })
      .from(importMap)
      .where(eq(importMap.kind, 'chapter'))
    // 10 fixture chapters. Three have no parsable number ("Prologue", "Chapter 1-2",
    // "Season 2 Finale") and are reported for review rather than guessed at, so 7 land.
    // Before the fix this was 5, with legacy post 102 contributing none of its two.
    expect(mapped.length).toBe(7)
  }, 180_000)
})
