import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Queue } from '@palscans/core/queue'
import {
  chapterGroups,
  chapters,
  createDb,
  type Db,
  type DbHandle,
  groups,
  manifestSources,
  runMigrations,
  series,
} from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { dueManifestSources, MAX_NEW_PER_CHECK, syncManifestSource } from './manifest-sync.js'

/**
 * `manifest.sync` — following a Cubari-style manifest instead of importing from it once.
 *
 * The assertions here are about restraint as much as about importing. This job runs
 * unattended against a file somebody else edits, so what matters is that a chapter that
 * vanished from the file stays on the site, that a number which already exists is never
 * overwritten, and that a file which has been deleted or broken records why rather than
 * taking the pass down with it. The happy path — "chapter 3 appeared, chapter 3 is queued" —
 * is the easy half.
 */

let dir: string
let handle: DbHandle
let db: Db
let seriesId: number

const makeQueue = () => {
  const added: Array<{ name: string; data: unknown; delayMs?: number }> = []
  const queue = {
    add: async (name: string, data: unknown, opts?: { jobId?: string; delayMs?: number }) => {
      added.push({ name, data, delayMs: opts?.delayMs })
      return opts?.jobId ?? name
    },
  } as unknown as Queue
  return { queue, added }
}

const MANIFEST_URL = 'https://raw.githubusercontent.com/someone/repo/main/series.json'

/**
 * An ImgChest id as the parser insists on one: exactly eleven alphanumeric characters.
 *
 * Derived from the chapter number so each chapter points somewhere different, which is what
 * makes the fingerprint assertions mean anything.
 */
const galleryId = (n: number | string) =>
  `c${String(n).replace('.', '')}`.padEnd(11, 'z').slice(0, 11)

/** A manifest body in the real shape: decimal keys, a named group, a Cubari proxy path. */
const manifestBody = (numbers: Array<number | string>, group = 'Illeterate Scans') => ({
  title: 'Solo',
  description: 'd',
  author: 'a',
  artist: 'b',
  cover: 'https://example.com/c.png',
  chapters: Object.fromEntries(
    numbers.map((n) => [
      String(n),
      {
        title: `Chapter ${n}`,
        volume: '1',
        groups: { [group]: `/proxy/api/imgchest/chapter/${galleryId(n)}/` },
        last_updated: '1617673932',
      },
    ]),
  ),
})

const serve = (body: unknown, status = 200) => {
  const calls: string[] = []
  const impl = (async (input: string | URL | Request) => {
    calls.push(String(input))
    if (status !== 200) return new Response('no', { status })
    return new Response(JSON.stringify(body), { status })
  }) as typeof globalThis.fetch
  return { impl, calls }
}

const addSource = async (over: Partial<typeof manifestSources.$inferInsert> = {}) => {
  const [row] = await db
    .insert(manifestSources)
    .values({ seriesId, url: MANIFEST_URL, language: 'en', ...over })
    .returning({ id: manifestSources.id })
  if (!row) throw new Error('insert returned nothing')
  return row.id
}

const readSource = async (id: number) => {
  const [row] = await db.select().from(manifestSources).where(eq(manifestSources.id, id)).limit(1)
  return row
}

const chapterNumbers = async (language = 'en') => {
  const rows = await db
    .select({ number: chapters.number })
    .from(chapters)
    .where(and(eq(chapters.seriesId, seriesId), eq(chapters.language, language)))
  return rows.map((r) => r.number).sort((a, b) => a - b)
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-sync-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
})

afterAll(async () => {
  await handle?.close?.()
  if (dir) await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  // A fresh series per test, so chapter numbers in one test cannot be "already here" in the
  // next — which is exactly the condition half of these assertions are about.
  await db.delete(manifestSources)
  const [row] = await db
    .insert(series)
    .values({
      slug: `solo-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      title: 'Solo',
      type: 'manhwa',
      state: 'published',
    })
    .returning({ id: series.id })
  seriesId = row?.id ?? 0
})

describe('a first check', () => {
  it('imports every chapter in the file and queues a download for each', async () => {
    const id = await addSource()
    const { queue, added } = makeQueue()
    const { impl } = serve(manifestBody([1, 2, '3.5']))

    const result = await syncManifestSource(id, { db, queue, fetchImpl: impl })

    expect(result.queued).toBe(3)
    expect(await chapterNumbers()).toEqual([1, 2, 3.5])
    expect(added.map((a) => a.name)).toEqual(['chapter.fetch', 'chapter.fetch', 'chapter.fetch'])
    // Staggered, like the hand-run import: three near-simultaneous conversations with an
    // image host is how an importer gets the site rate-limited.
    expect(added[0]?.delayMs).toBeUndefined()
    expect(added[1]?.delayMs).toBeGreaterThan(0)
  })

  it('leaves the chapters processing with a fetch document the worker can act on', async () => {
    const id = await addSource({ store: 'storage', publishMode: 'publish', isPremium: true })
    const { queue } = makeQueue()
    const { impl } = serve(manifestBody([7]))

    await syncManifestSource(id, { db, queue, fetchImpl: impl })

    const [row] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.seriesId, seriesId), eq(chapters.number, 7)))
      .limit(1)
    expect(row?.state).toBe('processing')
    expect(row?.processing?.fetch?.provider).toBe('imgchest')
    expect(row?.processing?.fetch?.mode).toBe('storage')
    expect(row?.processing?.fetch?.url).toContain('imgchest.com/p/')
    expect(row?.isPremium).toBe(true)
    // `publish` means it goes live when the pages land, which is what the mode is for.
    expect(row?.processing?.after?.publishedAt).toBeTruthy()
  })

  it('credits the group the file names, creating it if it is new', async () => {
    const id = await addSource()
    const { queue } = makeQueue()
    const { impl } = serve(manifestBody([1], 'Illeterate Scans'))

    await syncManifestSource(id, { db, queue, fetchImpl: impl })

    const credited = await db
      .select({ name: groups.name })
      .from(chapterGroups)
      .innerJoin(groups, eq(groups.id, chapterGroups.groupId))
      .innerJoin(chapters, eq(chapters.id, chapterGroups.chapterId))
      .where(eq(chapters.seriesId, seriesId))
    expect(credited.map((c) => c.name)).toEqual(['Illeterate Scans'])
  })

  it('defers past the per-check cap rather than queueing a whole backfill at once', async () => {
    const id = await addSource()
    const { queue, added } = makeQueue()
    const numbers = Array.from({ length: MAX_NEW_PER_CHECK + 4 }, (_, i) => i + 1)
    const { impl } = serve(manifestBody(numbers))

    const result = await syncManifestSource(id, { db, queue, fetchImpl: impl })

    expect(result.queued).toBe(MAX_NEW_PER_CHECK)
    expect(added).toHaveLength(MAX_NEW_PER_CHECK)
    // And crucially: no fingerprint, so the next pass still sees work rather than declaring
    // the file unchanged with four chapters never imported.
    expect((await readSource(id))?.fingerprint).toBeNull()

    const second = await syncManifestSource(id, { db, queue: makeQueue().queue, fetchImpl: impl })
    expect(second.queued).toBe(4)
    expect((await readSource(id))?.fingerprint).toBeTruthy()
  })
})

describe('a second check', () => {
  it('imports only what appeared since, and never touches what is already here', async () => {
    const id = await addSource()
    const { queue } = makeQueue()
    await syncManifestSource(id, { db, queue, fetchImpl: serve(manifestBody([1, 2])).impl })
    // Pretend chapter 1 finished processing, the way the real pipeline would leave it.
    await db
      .update(chapters)
      .set({ state: 'published', pageCount: 12, title: 'Edited by hand' })
      .where(and(eq(chapters.seriesId, seriesId), eq(chapters.number, 1)))

    const { queue: q2, added } = makeQueue()
    const result = await syncManifestSource(id, {
      db,
      queue: q2,
      fetchImpl: serve(manifestBody([1, 2, 3])).impl,
    })

    expect(result.queued).toBe(1)
    expect(added).toHaveLength(1)
    const [one] = await db
      .select({ state: chapters.state, title: chapters.title })
      .from(chapters)
      .where(and(eq(chapters.seriesId, seriesId), eq(chapters.number, 1)))
      .limit(1)
    expect(one?.state).toBe('published')
    expect(one?.title).toBe('Edited by hand')
  })

  it('stops at the fingerprint when the file has not changed', async () => {
    const id = await addSource()
    const first = serve(manifestBody([1, 2]))
    await syncManifestSource(id, { db, queue: makeQueue().queue, fetchImpl: first.impl })

    const second = serve(manifestBody([1, 2]))
    const result = await syncManifestSource(id, {
      db,
      queue: makeQueue().queue,
      fetchImpl: second.impl,
    })

    expect(result.unchanged).toBe(true)
    expect(result.queued).toBe(0)
    // One fetch and nothing else: this is the steady state of the feature, and it is the
    // reason a hundred followed series cost almost nothing.
    expect(second.calls).toHaveLength(1)
  })

  it('does not bring back a chapter an operator deleted', async () => {
    const id = await addSource()
    await syncManifestSource(id, {
      db,
      queue: makeQueue().queue,
      fetchImpl: serve(manifestBody([1, 2])).impl,
    })
    await db
      .update(chapters)
      .set({ deletedAt: new Date() })
      .where(and(eq(chapters.seriesId, seriesId), eq(chapters.number, 2)))

    const { queue, added } = makeQueue()
    // A changed file, so the fingerprint cannot be what stops it.
    const result = await syncManifestSource(id, {
      db,
      queue,
      fetchImpl: serve(manifestBody([1, 2, 3])).impl,
    })

    expect(result.queued).toBe(1)
    expect(added).toHaveLength(1)
  })

  it('leaves a chapter dropped from the file alone', async () => {
    const id = await addSource()
    await syncManifestSource(id, {
      db,
      queue: makeQueue().queue,
      fetchImpl: serve(manifestBody([1, 2])).impl,
    })

    await syncManifestSource(id, {
      db,
      queue: makeQueue().queue,
      fetchImpl: serve(manifestBody([1])).impl,
    })

    expect(await chapterNumbers()).toEqual([1, 2])
  })
})

describe('a file that cannot be read', () => {
  it('records the reason instead of throwing, and keeps the source active', async () => {
    const id = await addSource()
    const { impl } = serve(null, 404)

    const result = await syncManifestSource(id, { db, queue: makeQueue().queue, fetchImpl: impl })

    expect(result.error).toBeTruthy()
    const row = await readSource(id)
    expect(row?.lastError).toBeTruthy()
    expect(row?.lastCheckedAt).toBeTruthy()
    // Still active: a gist that 404s for ten minutes is a gist, not a decision to stop.
    expect(row?.active).toBe(true)
  })

  it('clears a recorded error once a check succeeds again', async () => {
    const id = await addSource()
    await syncManifestSource(id, { db, queue: makeQueue().queue, fetchImpl: serve(null, 500).impl })
    expect((await readSource(id))?.lastError).toBeTruthy()

    await syncManifestSource(id, {
      db,
      queue: makeQueue().queue,
      fetchImpl: serve(manifestBody([1])).impl,
    })
    expect((await readSource(id))?.lastError).toBeNull()
  })

  it('answers an unknown source id without touching anything', async () => {
    const result = await syncManifestSource(999_999, { db, queue: makeQueue().queue })
    expect(result.queued).toBe(0)
    expect(result.error).toBeNull()
  })
})

describe('which sources are due', () => {
  it('takes the never-checked first, then the stalest, and skips paused ones', async () => {
    const now = new Date('2026-03-01T12:00:00Z')
    const fresh = await addSource({
      url: `${MANIFEST_URL}?a`,
      lastCheckedAt: new Date(now.getTime() - 60_000),
    })
    const stale = await addSource({
      url: `${MANIFEST_URL}?b`,
      lastCheckedAt: new Date(now.getTime() - 3_600_000),
    })
    const never = await addSource({ url: `${MANIFEST_URL}?c` })
    const paused = await addSource({ url: `${MANIFEST_URL}?d`, active: false })

    const due = await dueManifestSources(db, { intervalMs: 15 * 60 * 1000, now })

    expect(due).toContain(never)
    expect(due).toContain(stale)
    expect(due).not.toContain(fresh)
    expect(due).not.toContain(paused)
    expect(due[0]).toBe(never)
  })

  it('honours the limit so one pass cannot fetch every followed file', async () => {
    for (const n of [1, 2, 3, 4]) await addSource({ url: `${MANIFEST_URL}?${n}` })
    const due = await dueManifestSources(db, { intervalMs: 1000, limit: 2 })
    expect(due).toHaveLength(2)
  })
})
