import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { MemoryQueue } from '@palscans/core/queue'
import { FsStorage, type Storage } from '@palscans/core/storage'
import {
  chapters,
  createDb,
  type Db,
  type DbHandle,
  runMigrations,
  seoSettings,
  series,
  sitemapBuilds,
} from '@palscans/db'
import { desc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readSitemapFile, readSitemapIndex } from '../../../web/lib/seo/sitemaps.js'
import {
  createSitemapCoalescer,
  lastFullSitemapBuildAt,
  resetSitemapEnv,
  runSitemapBuild,
  sitemapEnv,
} from './sitemap.js'

/**
 * `sitemap.build` end to end (docs/12 §5). The sitemap was never rebuilt after launch: the
 * job name existed and was acknowledged by a stub, nothing enqueued it, and `changedUrls` /
 * `submitIndexNow` were unreachable code. These are the three things that had to become true
 * — a publish enqueues one build for the whole burst, the build writes XML that contains the
 * new chapter, and IndexNow is attempted but can never take the build down with it.
 */
const SITE = 'https://palscans.test'

let dir: string
let handle: DbHandle
let db: Db
let storage: Storage
let seriesId = 0
let otherSeriesId = 0

const text = async (name: string): Promise<string> => {
  const bytes = await readSitemapFile(name, storage)
  if (!bytes) throw new Error(`${name} was not written`)
  return gunzipSync(Buffer.from(bytes)).toString('utf8')
}

const addChapter = async (n: number, seriesRef = seriesId) => {
  const [row] = await db
    .insert(chapters)
    .values({
      seriesId: seriesRef,
      number: n,
      state: 'published',
      publishedAt: new Date(),
      pageCount: 1,
    })
    .returning({ id: chapters.id })
  return row?.id ?? 0
}

const setSitemapSettings = async (value: Record<string, unknown>) => {
  await db
    .insert(seoSettings)
    .values({ key: 'sitemap', value })
    .onConflictDoUpdate({ target: seoSettings.key, set: { value } })
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-sitemap-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  storage = new FsStorage({ root: path.join(dir, 'storage'), publicUrl: `${SITE}/_storage` })
  const [s] = await db
    .insert(series)
    .values({ slug: 'blade-of-dusk', title: 'Blade of Dusk', type: 'manga', state: 'published' })
    .returning({ id: series.id })
  seriesId = s?.id ?? 0
  const [o] = await db
    .insert(series)
    .values({ slug: 'second-title', title: 'Second Title', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  otherSeriesId = o?.id ?? 0
}, 180_000)

afterAll(async () => {
  await handle?.close()
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await setSitemapSettings({})
})

describe('sitemapEnv', () => {
  it('treats a blank SITE_URL as unset instead of refusing to start', () => {
    const before = process.env.SITE_URL
    try {
      process.env.SITE_URL = ''
      resetSitemapEnv()
      expect(sitemapEnv().SITE_URL).toBe('http://localhost:3000')
      process.env.SITE_URL = 'https://palscans.test'
      resetSitemapEnv()
      expect(sitemapEnv().SITE_URL).toBe('https://palscans.test')
    } finally {
      if (before === undefined) delete process.env.SITE_URL
      else process.env.SITE_URL = before
      resetSitemapEnv()
    }
  })
})

describe('the publish → sitemap.build producer', () => {
  it('collapses a release burst into one incremental build for every series in it', async () => {
    const queue = new MemoryQueue('coalesce')
    const added: Array<{ kind: string; seriesIds?: number[] }> = []
    queue.process('sitemap.build', async (job) => {
      added.push(job.data)
    })
    const sitemaps = createSitemapCoalescer(queue, { debounceMs: 30 })

    // Six chapters of three series, the shape of a release day.
    sitemaps.note([7])
    sitemaps.note([7])
    sitemaps.note([9, 7])
    sitemaps.note([8])
    expect(sitemaps.pending()).toEqual([7, 9, 8])

    await new Promise((r) => setTimeout(r, 120))
    await queue.drain()

    expect(added).toEqual([{ kind: 'incremental', seriesIds: [7, 8, 9] }])
    expect(sitemaps.pending()).toEqual([])
    sitemaps.stop()
    await queue.close()
  })

  it('flushes what is pending on the way out, so a publish before a deploy is not lost', async () => {
    const queue = new MemoryQueue('flush')
    const added: Array<{ kind: string; seriesIds?: number[] }> = []
    queue.process('sitemap.build', async (job) => {
      added.push(job.data)
    })
    // A window far longer than this test: only the explicit flush can send it.
    const sitemaps = createSitemapCoalescer(queue, { debounceMs: 600_000 })
    sitemaps.note([4])

    await sitemaps.flush()
    await queue.drain()

    expect(added).toEqual([{ kind: 'incremental', seriesIds: [4] }])
    sitemaps.stop()
    await queue.close()
  })

  it('does not enqueue an empty build, and survives a queue that refuses one', async () => {
    const queue = new MemoryQueue('empty')
    const added: string[] = []
    queue.process('sitemap.build', async (job) => {
      added.push(job.id)
    })
    const sitemaps = createSitemapCoalescer(queue, { debounceMs: 5 })
    await sitemaps.flush()
    await queue.drain()
    expect(added).toEqual([])

    await queue.close()
    const errors: unknown[] = []
    const after = createSitemapCoalescer(queue, { debounceMs: 5, onError: (e) => errors.push(e) })
    after.note([1])
    await after.flush()
    expect(errors).toHaveLength(1)
    after.stop()
  })
})

describe('runSitemapBuild', () => {
  it('writes a full build, then an incremental one that carries the new chapter', async () => {
    await addChapter(1)
    const full = await runSitemapBuild({ db, storage, siteUrl: SITE }, { kind: 'full' })
    expect(full.error).toBeNull()
    expect(full.files.map((f) => f.name)).toContain('genres.xml.gz')
    expect(await text('chapters-1.xml.gz')).toContain(`${SITE}/series/blade-of-dusk/chapter-1`)

    // A new chapter goes live and only the series + chapters sections are rebuilt.
    await addChapter(2)
    const incremental = await runSitemapBuild(
      { db, storage, siteUrl: SITE },
      { kind: 'incremental', seriesIds: [seriesId] },
    )

    expect(incremental.error).toBeNull()
    expect(incremental.kind).toBe('incremental')
    const chapterXml = await text('chapters-1.xml.gz')
    expect(chapterXml).toContain(`${SITE}/series/blade-of-dusk/chapter-2`)
    expect(await text('series-1.xml.gz')).toContain(`${SITE}/series/blade-of-dusk`)
    // The sections it did not rebuild are kept from the previous build, not dropped.
    expect(incremental.files.map((f) => f.name)).toContain('genres.xml.gz')

    // The index the route serves lists every file and moves its lastmod forward.
    const index = await readSitemapIndex(storage)
    expect(index).toContain(`${SITE}/sitemaps/chapters-1.xml.gz`)

    const [row] = await db.select().from(sitemapBuilds).orderBy(desc(sitemapBuilds.id)).limit(1)
    expect(row?.kind).toBe('incremental')
    expect(row?.error).toBeNull()
    expect(row?.finishedAt).toBeInstanceOf(Date)
    expect(row?.urlCount).toBe(incremental.urlCount)
  }, 180_000)

  it('seeds the nightly clock from the last full build, so a restart does not rebuild', async () => {
    const at = await lastFullSitemapBuildAt(db)
    expect(at).toBeInstanceOf(Date)
    expect(Date.now() - (at?.getTime() ?? 0)).toBeLessThan(180_000)

    // A failed build must not count as one, or a broken nightly pass silently stops retrying.
    await db.insert(sitemapBuilds).values({
      kind: 'full',
      urlCount: 0,
      files: [],
      error: 'storage unreachable',
      startedAt: new Date(),
      finishedAt: new Date(),
    })
    expect((await lastFullSitemapBuildAt(db))?.getTime()).toBe(at?.getTime())
    await db.delete(sitemapBuilds).where(sql`${sitemapBuilds.error} is not null`)
  }, 180_000)
})

describe('IndexNow', () => {
  it('is skipped, without failing the build, when no key is configured', async () => {
    let called = false
    const result = await runSitemapBuild(
      {
        db,
        storage,
        siteUrl: SITE,
        fetchImpl: (async () => {
          called = true
          return new Response('', { status: 200 })
        }) as typeof fetch,
      },
      { kind: 'incremental', seriesIds: [seriesId] },
    )

    expect(result.error).toBeNull()
    expect(result.indexNow).toBeNull()
    expect(called).toBe(false)
  }, 180_000)

  it('submits the changed series and its recent chapters once a key is stored', async () => {
    await setSitemapSettings({ indexnow_key: 'abcdef0123456789' })
    const bodies: Array<Record<string, unknown>> = []
    const result = await runSitemapBuild(
      {
        db,
        storage,
        siteUrl: SITE,
        fetchImpl: (async (_url: string, init: RequestInit) => {
          bodies.push(JSON.parse(String(init.body)))
          return new Response('', { status: 202 })
        }) as unknown as typeof fetch,
      },
      { kind: 'incremental', seriesIds: [seriesId] },
    )

    expect(result.error).toBeNull()
    expect(result.indexNow).toMatchObject({ ok: true, status: 202 })
    const body = bodies[0] as { host: string; key: string; urlList: string[] }
    expect(body.host).toBe('palscans.test')
    expect(body.key).toBe('abcdef0123456789')
    expect(body.urlList).toContain(`${SITE}/series/blade-of-dusk`)
    expect(body.urlList).toContain(`${SITE}/series/blade-of-dusk/chapter-2`)
    // Only what changed: the other title is not resubmitted on every publish.
    expect(body.urlList.some((u) => u.includes('second-title'))).toBe(false)
  }, 180_000)

  it('records a dead endpoint as a failed submission, and still reports the build as good', async () => {
    await setSitemapSettings({ indexnow_key: 'abcdef0123456789' })
    const result = await runSitemapBuild(
      {
        db,
        storage,
        siteUrl: SITE,
        fetchImpl: (async () => {
          throw new Error('ECONNREFUSED api.indexnow.org')
        }) as typeof fetch,
      },
      { kind: 'incremental', seriesIds: [seriesId] },
    )

    expect(result.error).toBeNull()
    expect(result.urlCount).toBeGreaterThan(0)
    expect(result.indexNow?.ok).toBe(false)
    expect(result.indexNow?.error).toContain('ECONNREFUSED')

    // And the files really were written before the submission was attempted.
    expect(await text('chapters-1.xml.gz')).toContain('/series/blade-of-dusk/chapter-2')
    const [row] = await db
      .select({ error: sitemapBuilds.error })
      .from(sitemapBuilds)
      .orderBy(desc(sitemapBuilds.id))
      .limit(1)
    expect(row?.error).toBeNull()
  }, 180_000)

  it('leaves a series that is no longer indexable out of the submission', async () => {
    await setSitemapSettings({ indexnow_key: 'abcdef0123456789' })
    await db.update(series).set({ noindex: true }).where(eq(series.id, otherSeriesId))
    const bodies: Array<{ urlList: string[] }> = []
    await runSitemapBuild(
      {
        db,
        storage,
        siteUrl: SITE,
        fetchImpl: (async (_url: string, init: RequestInit) => {
          bodies.push(JSON.parse(String(init.body)))
          return new Response('', { status: 200 })
        }) as unknown as typeof fetch,
      },
      { kind: 'incremental', seriesIds: [seriesId, otherSeriesId] },
    )

    expect(bodies[0]?.urlList.some((u) => u.includes('second-title'))).toBe(false)
    expect(bodies[0]?.urlList).toContain(`${SITE}/series/blade-of-dusk`)
    await db.update(series).set({ noindex: false }).where(eq(series.id, otherSeriesId))
  }, 180_000)
})
