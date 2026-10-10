import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Queue } from '@palscans/core/queue'
import type { Storage } from '@palscans/core/storage'
import {
  type ChapterProcessing,
  chapterPages,
  chapters,
  createDb,
  type Db,
  type DbHandle,
  runMigrations,
  series,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fetchChapterGallery } from './chapter-fetch.js'

/**
 * `chapter.fetch` — the gallery import's download step.
 *
 * What is worth asserting here is the handover, not the HTTP: the job's whole purpose is to
 * leave behind exactly the processing document that `/api/upload/commit` would have written,
 * so that everything downstream cannot tell an import from an upload. The things that go
 * wrong are therefore all state: sources in the wrong order, the marker not cleared (so a
 * redelivery downloads twice), a failure that leaves the chapter stuck in `processing`
 * forever, or an encode enqueued over an empty source list.
 */

let dir: string
let handle: DbHandle
let db: Db
let seriesId: number

/** An in-memory store that records what was written, in place of R2. */
const makeStorage = () => {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  const storage = {
    driver: 'fs',
    put: async (key: string, body: Uint8Array | string, opts?: { contentType?: string }) => {
      objects.set(key, {
        bytes: typeof body === 'string' ? new TextEncoder().encode(body) : body,
        contentType: opts?.contentType,
      })
    },
  } as unknown as Storage
  return { storage, objects }
}

const makeQueue = () => {
  const added: Array<{ name: string; data: unknown; jobId?: string }> = []
  const queue = {
    add: async (name: string, data: unknown, opts?: { jobId?: string }) => {
      added.push({ name, data, jobId: opts?.jobId })
      return opts?.jobId ?? name
    },
  } as unknown as Queue
  return { queue, added }
}

/**
 * A real 8x12 PNG per page, not a magic-byte stub.
 *
 * Remote mode measures each image with sharp to get the dimensions the reader lays out
 * with, so the fixture has to be an image something can actually decode. The green channel
 * carries the page number, which is what makes the ordering assertions mean anything.
 */
const pageBytes = async (n: number): Promise<Uint8Array> =>
  new Uint8Array(
    await sharp({
      create: { width: 8, height: 12, channels: 3, background: { r: 10, g: n, b: 20 } },
    })
      .png()
      .toBuffer(),
  )

const stream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes)
      c.close()
    },
  })

interface FakeOptions {
  pages?: number
  /** Fail the image at this 1-based position with an HTTP status. */
  failAt?: { position: number; status: number }
  galleryStatus?: number
  /** Serve each image once, then refuse — a host that tolerates a browser but not a proxy. */
  onlyOnce?: boolean
}

const fakeFetch = (opts: FakeOptions = {}) => {
  const pages = opts.pages ?? 3
  const calls: string[] = []
  const impl = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url === 'https://imgchest.com/p/na7kjb9bq48') {
      if (opts.galleryStatus && opts.galleryStatus !== 200)
        return new Response('no', { status: opts.galleryStatus })
      const files = Array.from({ length: pages }, (_, i) => ({
        id: `f${i + 1}`,
        link: `https://cdn.imgchest.com/files/p${i + 1}.png`,
        position: i + 1,
      }))
      const json = JSON.stringify({
        props: { post: { slug: 'na7kjb9bq48', title: 'Ch 1', nsfw: 0, files } },
      })
      const html = `<div id="app" data-page="${json.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div>`
      const response = new Response(stream(new TextEncoder().encode(html)), { status: 200 })
      Object.defineProperty(response, 'url', { value: url })
      return response
    }
    const match = /\/files\/p(\d+)\.png$/.exec(url)
    if (match) {
      const n = Number(match[1])
      if (opts.failAt?.position === n) return new Response('nope', { status: opts.failAt.status })
      if (opts.onlyOnce && calls.filter((c) => c === url).length > 1)
        return new Response('slow down', { status: 429 })
      const response = new Response(stream(await pageBytes(n)), { status: 200 })
      Object.defineProperty(response, 'url', { value: url })
      return response
    }
    return new Response('not found', { status: 404 })
  }) as typeof globalThis.fetch
  return { impl, calls }
}

const pendingDoc = (over: Partial<ChapterProcessing> = {}): ChapterProcessing => ({
  sources: [],
  progress: { done: 0, total: 3 },
  errors: {},
  attempt: 1,
  mode: 'all',
  fetch: {
    url: 'https://imgchest.com/p/na7kjb9bq48',
    provider: 'imgchest',
    title: 'Ch 1',
    // These suites are about the download path; remote has its own below, and is the
    // default for a real import.
    mode: 'storage' as const,
  },
  after: { isPremium: false, publishedAt: null },
  startedAt: null,
  finishedAt: null,
  ...over,
})

const makeChapter = async (number: number, processing: ChapterProcessing | null) => {
  const [row] = await db
    .insert(chapters)
    .values({ seriesId, number, state: 'processing', processing })
    .returning({ id: chapters.id })
  if (!row) throw new Error('insert returned nothing')
  return row.id
}

const read = async (id: number) => {
  const [row] = await db
    .select({ state: chapters.state, processing: chapters.processing })
    .from(chapters)
    .where(eq(chapters.id, id))
    .limit(1)
  return row
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-fetch-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  const [row] = await db
    .insert(series)
    .values({ slug: 'solo', title: 'Solo', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  seriesId = row?.id ?? 0
})

afterAll(async () => {
  await handle?.close?.()
  if (dir) await rm(dir, { recursive: true, force: true })
})

let n = 100
beforeEach(() => {
  n += 1
})

describe('a gallery that downloads cleanly', () => {
  it('writes the sources the upload path would have written, in gallery order', async () => {
    const id = await makeChapter(n, pendingDoc())
    const { storage, objects } = makeStorage()
    const { queue } = makeQueue()
    const { impl } = fakeFetch({ pages: 3 })
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: impl })

    const row = await read(id)
    expect(row?.processing?.sources).toHaveLength(3)
    expect(row?.processing?.sources.map((s) => s.idx)).toEqual([0, 1, 2])
    // The key shape is load-bearing: /api/upload/commit and the page editor both assume
    // `uploads/<series>/<chapter>/`, so an import that invented a layout would be invisible.
    for (const [i, source] of (row?.processing?.sources ?? []).entries())
      expect(source.key).toMatch(
        new RegExp(`^uploads/${seriesId}/${id}/000${i}-[0-9a-f]{12}\\.png$`),
      )
    expect(objects.size).toBe(3)
    for (const object of objects.values()) expect(object.contentType).toBe('image/png')
  })

  it('keeps page order even though downloads finish out of order', async () => {
    // `pool` runs three at a time and resolves in whatever order the network returns; the
    // job indexes into the array rather than pushing, and this is what proves it.
    const id = await makeChapter(n, pendingDoc())
    const { storage, objects } = makeStorage()
    const { queue } = makeQueue()
    const { impl } = fakeFetch({ pages: 5 })
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: impl })

    const row = await read(id)
    // The page number is the green channel of the fixture, so this reads what was actually
    // stored at each index rather than trusting the order the array happens to be in.
    const bodies = await Promise.all(
      (row?.processing?.sources ?? []).map(async (s) => {
        const bytes = objects.get(s.key)?.bytes
        if (!bytes) return -1
        const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
        return data[1] ?? -1
      }),
    )
    expect(bodies).toEqual([1, 2, 3, 4, 5])
  })

  it('clears the fetch marker and hands over to chapter.process', async () => {
    const id = await makeChapter(n, pendingDoc())
    const { storage } = makeStorage()
    const { queue, added } = makeQueue()
    const { impl } = fakeFetch()
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: impl })

    const row = await read(id)
    expect(row?.state).toBe('processing')
    expect(row?.processing?.fetch).toBeUndefined()
    expect(added).toHaveLength(1)
    expect(added[0]?.name).toBe('chapter.process')
    expect(added[0]?.data).toEqual({ chapterId: id })
  })

  it('carries the publish intent through untouched', async () => {
    // `after` is applied by chapter.process when the encode ends, so the import has to keep
    // it rather than re-deciding it.
    const id = await makeChapter(
      n,
      pendingDoc({ after: { isPremium: true, publishedAt: '2026-01-01T00:00:00.000Z' } }),
    )
    const { storage } = makeStorage()
    const { queue } = makeQueue()
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: fakeFetch().impl })
    expect((await read(id))?.processing?.after).toEqual({
      isPremium: true,
      publishedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('bumps the attempt so the encode job id is new', async () => {
    const id = await makeChapter(n, pendingDoc({ attempt: 4 }))
    const { storage } = makeStorage()
    const { queue, added } = makeQueue()
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: fakeFetch().impl })
    expect((await read(id))?.processing?.attempt).toBe(5)
    expect(added[0]?.jobId).toBe(`chapter.process:${id}:5`)
  })
})

describe('a gallery that does not', () => {
  it('fails the chapter rather than leaving it processing forever', async () => {
    const id = await makeChapter(n, pendingDoc())
    const { storage } = makeStorage()
    const { queue, added } = makeQueue()
    const { impl } = fakeFetch({ galleryStatus: 404 })
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: impl })

    const row = await read(id)
    expect(row?.state).toBe('failed')
    // Never an encode over an empty source list — that "succeeds" and publishes no pages.
    expect(added).toHaveLength(0)
  })

  it('says what went wrong in words the operator can act on', async () => {
    const id = await makeChapter(n, pendingDoc())
    const { storage } = makeStorage()
    const { queue } = makeQueue()
    await fetchChapterGallery(id, {
      db,
      storage,
      queue,
      fetchImpl: fakeFetch({ galleryStatus: 404 }).impl,
    })
    expect((await read(id))?.processing?.errors.fetch).toContain('does not exist')
  })

  it('keeps the marker on failure so Retry can resume the download', async () => {
    const id = await makeChapter(n, pendingDoc())
    const { storage } = makeStorage()
    const { queue } = makeQueue()
    await fetchChapterGallery(id, {
      db,
      storage,
      queue,
      fetchImpl: fakeFetch({ galleryStatus: 500 }).impl,
    })
    expect((await read(id))?.processing?.fetch?.url).toBe('https://imgchest.com/p/na7kjb9bq48')
  })

  it('fails the whole chapter when one page cannot be downloaded', async () => {
    // A chapter missing page 2 is worse than no chapter: it looks fine in the list and wrong
    // to a reader, with nothing anywhere recording that a page was dropped.
    const id = await makeChapter(n, pendingDoc())
    const { storage } = makeStorage()
    const { queue, added } = makeQueue()
    const { impl } = fakeFetch({ pages: 3, failAt: { position: 2, status: 500 } })
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: impl })

    const row = await read(id)
    expect(row?.state).toBe('failed')
    expect(row?.processing?.sources).toHaveLength(0)
    expect(added).toHaveLength(0)
  })
})

describe('redelivery', () => {
  it('does nothing when the download already finished', async () => {
    // BullMQ redelivers. Without the marker check this downloads the gallery a second time
    // and races the first run's sources.
    const id = await makeChapter(n, pendingDoc())
    const { storage } = makeStorage()
    const { queue, added } = makeQueue()
    const { impl, calls } = fakeFetch()
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: impl })
    const after = calls.length
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: impl })

    expect(calls.length).toBe(after)
    expect(added).toHaveLength(1)
  })

  it('does nothing for a chapter with no processing document at all', async () => {
    const id = await makeChapter(n, null)
    const { storage } = makeStorage()
    const { queue, added } = makeQueue()
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: fakeFetch().impl })
    expect(added).toHaveLength(0)
  })

  it('does nothing for a chapter that no longer exists', async () => {
    const { storage } = makeStorage()
    const { queue, added } = makeQueue()
    await expect(
      fetchChapterGallery(999_999, { db, storage, queue, fetchImpl: fakeFetch().impl }),
    ).resolves.toBeUndefined()
    expect(added).toHaveLength(0)
  })
})

describe('remote mode: pages stay on the host', () => {
  const remoteDoc = () =>
    pendingDoc({
      fetch: { url: 'https://imgchest.com/p/na7kjb9bq48', provider: 'imgchest', mode: 'remote' },
    })

  it('stores nothing and points the pages at the host', async () => {
    // The entire point of the mode: the bucket stays empty.
    const id = await makeChapter(n, remoteDoc())
    const { storage, objects } = makeStorage()
    const { queue, added } = makeQueue()
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: fakeFetch().impl })

    expect(objects.size).toBe(0)
    const pages = await db
      .select()
      .from(chapterPages)
      .where(eq(chapterPages.chapterId, id))
      .orderBy(chapterPages.idx)
    expect(pages).toHaveLength(3)
    expect(pages.map((p) => p.remoteUrl)).toEqual([
      'https://cdn.imgchest.com/files/p1.png',
      'https://cdn.imgchest.com/files/p2.png',
      'https://cdn.imgchest.com/files/p3.png',
    ])
    // No encode to hand over to — the pages are final the moment they are measured.
    expect(added).toHaveLength(0)
  })

  it('measures the real dimensions rather than guessing them', async () => {
    // The reader lays out from these. Zero would mean every page jumping into place as it
    // loads, which is the thing intrinsic dimensions exist to prevent.
    const id = await makeChapter(n, remoteDoc())
    const { storage } = makeStorage()
    const { queue } = makeQueue()
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: fakeFetch().impl })
    const pages = await db.select().from(chapterPages).where(eq(chapterPages.chapterId, id))
    for (const page of pages) {
      expect(page.width).toBe(8)
      expect(page.height).toBe(12)
      expect(page.blurHash).toBeTruthy()
      expect(page.variants).toEqual([])
    }
  })

  it('gives the key a value that cannot be mistaken for a bucket path', async () => {
    const id = await makeChapter(n, remoteDoc())
    const { storage } = makeStorage()
    const { queue } = makeQueue()
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: fakeFetch().impl })
    const pages = await db.select().from(chapterPages).where(eq(chapterPages.chapterId, id))
    for (const page of pages) expect(page.key.startsWith('remote:')).toBe(true)
  })

  it('finishes the chapter itself, with the page count and the publish intent applied', async () => {
    const id = await makeChapter(
      n,
      pendingDoc({
        fetch: { url: 'https://imgchest.com/p/na7kjb9bq48', provider: 'imgchest', mode: 'remote' },
        after: { isPremium: false, publishedAt: '2020-01-01T00:00:00.000Z' },
      }),
    )
    const { storage } = makeStorage()
    const { queue } = makeQueue()
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: fakeFetch().impl })
    const [row] = await db
      .select({ state: chapters.state, pageCount: chapters.pageCount })
      .from(chapters)
      .where(eq(chapters.id, id))
    expect(row?.state).toBe('published')
    expect(row?.pageCount).toBe(3)
  })

  it('records that the pages are remote, and keeps where they came from', async () => {
    const id = await makeChapter(n, remoteDoc())
    const { storage } = makeStorage()
    const { queue } = makeQueue()
    await fetchChapterGallery(id, { db, storage, queue, fetchImpl: fakeFetch().impl })
    const row = await read(id)
    expect(row?.processing?.pageSource).toBe('remote')
    // Unlike the storage path, the marker survives: it is the only record of the origin.
    expect(row?.processing?.fetch?.url).toBe('https://imgchest.com/p/na7kjb9bq48')
  })

  it('falls back to storing when the host will not serve us twice', async () => {
    /**
     * The probe earning its keep. A host that answers the first request and refuses the
     * second cannot back a proxy, because the proxy fetches on every cache miss — so the
     * chapter would import cleanly and break for readers later.
     */
    const id = await makeChapter(n, remoteDoc())
    const { storage, objects } = makeStorage()
    const { queue, added } = makeQueue()
    await fetchChapterGallery(id, {
      db,
      storage,
      queue,
      fetchImpl: fakeFetch({ onlyOnce: true }).impl,
    })

    expect(objects.size).toBe(3)
    expect(added).toHaveLength(1)
    expect(added[0]?.name).toBe('chapter.process')
    const row = await read(id)
    expect(row?.processing?.sources).toHaveLength(3)
    const pages = await db.select().from(chapterPages).where(eq(chapterPages.chapterId, id))
    expect(pages).toHaveLength(0)
  })

  it('fails the chapter when a page is not an image, rather than storing a broken one', async () => {
    const id = await makeChapter(n, remoteDoc())
    const { storage } = makeStorage()
    const { queue } = makeQueue()
    await fetchChapterGallery(id, {
      db,
      storage,
      queue,
      fetchImpl: fakeFetch({ pages: 3, failAt: { position: 2, status: 500 } }).impl,
    })
    expect((await read(id))?.state).toBe('failed')
    const pages = await db.select().from(chapterPages).where(eq(chapterPages.chapterId, id))
    expect(pages).toHaveLength(0)
  })
})
