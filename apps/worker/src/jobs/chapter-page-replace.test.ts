import type { Storage } from '@palscans/core/storage'
import {
  chapterPages,
  chapters,
  createDb,
  type Db,
  type DbHandle,
  runMigrations,
  series,
} from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ReplacePageError, replaceChapterPage } from './chapter-page-replace.js'

/**
 * `chapter.page.replace` — one page of a remote chapter swapped for an upload.
 *
 * The thing this job must get right is restraint. It runs on chapters whose pages are not
 * ours and cannot be rebuilt, so there is no run to re-do and nothing to fall back on: a
 * bug here is a chapter an operator has to re-import. The assertions below are therefore
 * about what it does *not* touch — the other pages, their remote URLs, the page count, the
 * order — as much as about the row it is asked to change.
 *
 * The second half is the mixed state it leaves behind. A chapter with one page of ours and
 * eleven on someone else's host is a state nothing else in the codebase creates, and the
 * reason it is safe is that `toReaderPages` already branches per page on `remoteUrl`. These
 * pin that the row really does stop being remote, because that single column is the whole
 * mechanism.
 */

let handle: DbHandle
let db: Db
let chapterId: number
let seriesId: number

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#4455aa' } })
    .png()
    .toBuffer()

/** An in-memory store standing in for R2, recording every object written. */
const makeStorage = (sources: Map<string, Uint8Array>) => {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  const storage = {
    driver: 'fs',
    head: async (key: string) => {
      const s = sources.get(key)
      return s ? { size: s.byteLength } : null
    },
    get: async (key: string) => sources.get(key) ?? null,
    put: async (key: string, body: Uint8Array | string, opts?: { contentType?: string }) => {
      objects.set(key, {
        bytes: typeof body === 'string' ? new TextEncoder().encode(body) : body,
        contentType: opts?.contentType,
      })
    },
  } as unknown as Storage
  return { storage, objects }
}

/** A chapter as a remote import leaves it: rows with `remoteUrl`, an empty results map. */
const seedRemoteChapter = async (pageCount: number) => {
  await db.delete(chapterPages)
  await db.delete(chapters)
  const [row] = await db
    .insert(chapters)
    .values({
      seriesId,
      number: 1,
      state: 'published',
      pageCount,
      processing: {
        sources: [],
        results: {},
        errors: {},
        progress: { done: pageCount, total: pageCount },
        attempt: 1,
        mode: 'all',
        pageSource: 'remote',
        startedAt: null,
        finishedAt: '2026-01-01T00:00:00.000Z',
        fetch: {
          url: 'https://imgchest.com/p/abcdefghijk',
          provider: 'imgchest',
          mode: 'remote',
        },
      },
    })
    .returning({ id: chapters.id })
  chapterId = row?.id as number
  await db.insert(chapterPages).values(
    Array.from({ length: pageCount }, (_, idx) => ({
      chapterId,
      idx,
      key: `remote:deadbeef${idx}.png`,
      remoteUrl: `https://cdn.imgchest.com/files/page${idx}.png`,
      width: 800,
      height: 1200,
      bytes: 1000 + idx,
      blurHash: null,
      variants: [],
    })),
  )
}

const pagesOf = () =>
  db
    .select({
      idx: chapterPages.idx,
      key: chapterPages.key,
      remoteUrl: chapterPages.remoteUrl,
      width: chapterPages.width,
      height: chapterPages.height,
    })
    .from(chapterPages)
    .where(eq(chapterPages.chapterId, chapterId))
    .orderBy(chapterPages.idx)

beforeAll(async () => {
  handle = await createDb('pglite://memory')
  db = handle.db
  await runMigrations(handle)
  const [s1] = await db
    .insert(series)
    .values({ slug: 's', title: 'S', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  seriesId = s1?.id as number
})

afterAll(async () => {
  await handle.close()
})

beforeEach(async () => {
  await seedRemoteChapter(12)
})

describe('replaceChapterPage', () => {
  it('makes one page ours and leaves the other eleven on the host', async () => {
    const sources = new Map([['uploads/x/new.png', new Uint8Array(await png(800, 1200))]])
    const { storage, objects } = makeStorage(sources)

    await replaceChapterPage(chapterId, 4, 'uploads/x/new.png', { db, storage })

    const rows = await pagesOf()
    expect(rows).toHaveLength(12)
    const replaced = rows.find((r) => r.idx === 4)
    expect(replaced?.remoteUrl).toBeNull()
    expect(replaced?.key).toMatch(new RegExp(`^pages/${seriesId}/\\d+/`))
    // Every other page is exactly as it was. This is the assertion that matters: the job
    // runs on chapters that cannot be rebuilt, so a stray write is unrecoverable.
    for (const row of rows.filter((r) => r.idx !== 4)) {
      expect(row.remoteUrl).toBe(`https://cdn.imgchest.com/files/page${row.idx}.png`)
      expect(row.key).toBe(`remote:deadbeef${row.idx}.png`)
    }
    // The variants really were written, so the new URL resolves to an object.
    expect([...objects.keys()].some((k) => k.startsWith(`pages/${seriesId}/`))).toBe(true)
  })

  it('keeps the page count and the order', async () => {
    const sources = new Map([['uploads/x/new.png', new Uint8Array(await png(800, 1200))]])
    const { storage } = makeStorage(sources)
    await replaceChapterPage(chapterId, 0, 'uploads/x/new.png', { db, storage })
    const rows = await pagesOf()
    expect(rows.map((r) => r.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('takes the replacement its own dimensions, not the old page’s', async () => {
    // The row carried 800x1200 from the import. A reader lays out from these numbers, so
    // carrying the old ones over would letterbox or crop the new page.
    const sources = new Map([['uploads/x/tall.png', new Uint8Array(await png(1000, 1500))]])
    const { storage } = makeStorage(sources)
    await replaceChapterPage(chapterId, 3, 'uploads/x/tall.png', { db, storage })
    const row = (await pagesOf()).find((r) => r.idx === 3)
    expect(row?.width).toBe(1000)
    expect(row?.height).toBe(1500)
  })

  it('records the replacement in the document without inventing a source', async () => {
    const sources = new Map([['uploads/x/new.png', new Uint8Array(await png(800, 1200))]])
    const { storage } = makeStorage(sources)
    await replaceChapterPage(chapterId, 7, 'uploads/x/new.png', { db, storage })
    const [row] = await db
      .select({ processing: chapters.processing })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .limit(1)
    expect(row?.processing?.replacedPages?.['7']?.key).toMatch(new RegExp(`^pages/${seriesId}/`))
    // Still a remote import as far as every other job is concerned. Writing a source here
    // would make the next fetch or watermark run operate on a page that does not exist.
    expect(row?.processing?.sources).toEqual([])
    expect(row?.processing?.results).toEqual({})
    expect(row?.processing?.pageSource).toBe('remote')
  })

  it('is idempotent: the same image twice leaves the same row', async () => {
    const sources = new Map([['uploads/x/new.png', new Uint8Array(await png(800, 1200))]])
    const { storage } = makeStorage(sources)
    await replaceChapterPage(chapterId, 2, 'uploads/x/new.png', { db, storage })
    const first = (await pagesOf()).find((r) => r.idx === 2)
    await replaceChapterPage(chapterId, 2, 'uploads/x/new.png', { db, storage })
    const second = (await pagesOf()).find((r) => r.idx === 2)
    // Content-addressed keys, so a redelivery of the job writes the row to what it holds.
    expect(second).toEqual(first)
  })

  it('replaces a page that is already ours, rather than refusing', async () => {
    // Half-converted chapters are the normal state here; a second fix to the same page
    // must not depend on whether the first one happened.
    const sources = new Map([
      ['uploads/x/a.png', new Uint8Array(await png(800, 1200))],
      ['uploads/x/b.png', new Uint8Array(await png(820, 1300))],
    ])
    const { storage } = makeStorage(sources)
    await replaceChapterPage(chapterId, 5, 'uploads/x/a.png', { db, storage })
    await replaceChapterPage(chapterId, 5, 'uploads/x/b.png', { db, storage })
    const row = (await pagesOf()).find((r) => r.idx === 5)
    expect(row?.width).toBe(820)
    expect(row?.remoteUrl).toBeNull()
  })

  it('refuses an image that would split into several pages', async () => {
    /*
     * A long strip is cut into segments by the encode. That is right for an import and
     * wrong for this: replacing page 7 with three pages would renumber everything after
     * it, on a chapter that cannot be rebuilt. Refused, and nothing written.
     */
    const sources = new Map([['uploads/x/strip.png', new Uint8Array(await png(800, 40_000))]])
    const { storage, objects } = makeStorage(sources)
    await expect(
      replaceChapterPage(chapterId, 7, 'uploads/x/strip.png', { db, storage }),
    ).rejects.toBeInstanceOf(ReplacePageError)
    const row = (await pagesOf()).find((r) => r.idx === 7)
    expect(row?.remoteUrl).toBe('https://cdn.imgchest.com/files/page7.png')
    expect([...objects.keys()].filter((k) => k.startsWith('pages/'))).toEqual([])
  })

  it('refuses a page index the chapter does not have', async () => {
    const sources = new Map([['uploads/x/new.png', new Uint8Array(await png(800, 1200))]])
    const { storage } = makeStorage(sources)
    await expect(
      replaceChapterPage(chapterId, 99, 'uploads/x/new.png', { db, storage }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(await pagesOf()).toHaveLength(12)
  })

  it('refuses when the uploaded object is not in the store', async () => {
    const { storage } = makeStorage(new Map())
    await expect(
      replaceChapterPage(chapterId, 1, 'uploads/x/missing.png', { db, storage }),
    ).rejects.toMatchObject({ code: 'missing_object' })
    const row = (await pagesOf()).find((r) => r.idx === 1)
    expect(row?.remoteUrl).toBe('https://cdn.imgchest.com/files/page1.png')
  })
})
