import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Queue } from '@palscans/core/queue'
import type { Storage } from '@palscans/core/storage'
import {
  type ChapterProcessing,
  chapters,
  createDb,
  type Db,
  type DbHandle,
  runMigrations,
  series,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
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

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

/** A distinct body per page, so ordering assertions mean something. */
const pageBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(PNG.length + 1)
  out.set(PNG, 0)
  out[PNG.length] = n
  return out
}

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
      const response = new Response(stream(pageBytes(n)), { status: 200 })
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
  fetch: { url: 'https://imgchest.com/p/na7kjb9bq48', provider: 'imgchest', title: 'Ch 1' },
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
    const bodies = (row?.processing?.sources ?? []).map(
      (s) => objects.get(s.key)?.bytes.at(-1) ?? -1,
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
