import type { SessionUser } from '@palscans/core'
import {
  chapters,
  createDb,
  type Db,
  type DbHandle,
  runMigrations,
  series,
  users,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Importing a whole series from one manifest link.
 *
 * What is worth asserting is the bulk behaviour, not the parsing — that is covered in
 * @palscans/core against eleven real files. Here: that a conflict in the middle of a hundred
 * chapters skips one rather than abandoning ninety-nine, that the operator's selection beats
 * the file, that nothing is queued before its row exists, and that a backfill is spread out
 * rather than fired at an image host all at once.
 */

let handle: DbHandle
let db: Db
const ids = { staff: 0, series: 0 }

const state = vi.hoisted(() => ({
  user: null as unknown,
  enqueued: [] as Array<{ chapterId: number; delayMs: number }>,
  /** Chapter rows visible at the moment each job was enqueued — the ordering guard. */
  rowsAtEnqueue: [] as number[],
}))

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return {
    ...actual,
    withPermission:
      (_permission: string, handler: (r: Request, c: unknown, u: unknown) => Promise<Response>) =>
      (request: Request, ctx: unknown) =>
        handler(request, ctx, state.user),
  }
})

vi.mock('@palscans/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@palscans/db')>()
  return { ...actual, getDb: async () => db }
})

vi.mock('@/components/admin/server/audit', () => ({ audit: async () => undefined }))

vi.mock('@/components/admin/server/chapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/admin/server/chapters')>()
  return {
    ...actual,
    enqueueFetch: async (chapterId: number, attempt: number, delayMs = 0) => {
      state.enqueued.push({ chapterId, delayMs })
      const rows = await db.select().from(chapters)
      state.rowsAtEnqueue.push(rows.length)
      return `chapter.fetch:${chapterId}:${attempt}`
    },
  }
})

/** A manifest of `n` chapters, numbered from 1, each pointing at an Imgur album. */
const manifestOf = (numbers: number[]) => ({
  title: 'A long series',
  description: 'many chapters',
  author: 'Someone',
  artist: 'Someone',
  cover: 'https://cdn.example.com/cover.jpg',
  chapters: Object.fromEntries(
    numbers.map((n) => [
      String(n),
      {
        title: `Chapter ${n}`,
        volume: '1',
        groups: { 'A Group': `/proxy/api/imgur/chapter/aaaaa${String(n).padStart(2, '0')}/` },
        last_updated: '1617673932',
      },
    ]),
  ),
})

let currentManifest: unknown = manifestOf([1, 2, 3])

vi.mock('@palscans/core/gallery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@palscans/core/gallery')>()
  return {
    ...actual,
    // The parser stays real: it is what turns the file into intents, and stubbing it would
    // test a mock rather than the import.
    resolveManifest: async (_url: string, opts: { group?: string | null } = {}) => ({
      url: 'https://raw.githubusercontent.com/u/r/main/series.json',
      manifest: actual.parseManifest(currentManifest, { group: opts.group ?? null }),
    }),
  }
})

const { POST } = await import('./route')

const user = (role: SessionUser['role']): SessionUser =>
  ({ id: ids.staff, role, username: 'staff', email: 'staff@palscans.org' }) as SessionUser

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/admin/chapters/import/manifest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  )

const body = (over: Record<string, unknown> = {}) => ({
  url: 'https://github.com/u/r/blob/main/series.json',
  seriesId: ids.series,
  ...over,
})

const rows = async () =>
  db
    .select({
      id: chapters.id,
      number: chapters.number,
      state: chapters.state,
      volume: chapters.volume,
      language: chapters.language,
      processing: chapters.processing,
    })
    .from(chapters)
    .where(eq(chapters.seriesId, ids.series))
    .orderBy(chapters.number)

beforeAll(async () => {
  handle = await createDb('pglite://memory')
  db = handle.db
  await runMigrations(handle)
  const [staff] = await db
    .insert(users)
    .values({ username: 'mstaff', email: 'mstaff@palscans.org', role: 'admin' })
    .returning({ id: users.id })
  ids.staff = staff?.id ?? 0
  const [s] = await db
    .insert(series)
    .values({ slug: 'long', title: 'Long', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  ids.series = s?.id ?? 0
})

afterAll(async () => {
  await handle?.close?.()
})

beforeEach(async () => {
  await db.delete(chapters)
  state.user = user('admin')
  state.enqueued = []
  state.rowsAtEnqueue = []
  currentManifest = manifestOf([1, 2, 3])
})

describe('importing a manifest', () => {
  it('creates a chapter per entry and queues each one', async () => {
    const response = await post(body())
    expect(response.status).toBe(200)
    const json = (await response.json()) as { data: { queued: number } }
    expect(json.data.queued).toBe(3)
    expect(await rows()).toHaveLength(3)
    expect(state.enqueued).toHaveLength(3)
  })

  it('records where each chapter comes from, as a remote import', async () => {
    await post(body())
    const all = await rows()
    expect(all.map((r) => r.processing?.fetch?.provider)).toEqual(['imgur', 'imgur', 'imgur'])
    expect(all[0]?.processing?.fetch?.url).toBe('https://imgur.com/a/aaaaa01')
    expect(all[0]?.processing?.fetch?.mode).toBe('remote')
    expect(all.every((r) => r.state === 'processing')).toBe(true)
  })

  it('carries the title and volume from the manifest', async () => {
    await post(body())
    const all = await rows()
    expect(all[0]?.processing?.fetch?.title).toBe('Chapter 1')
    expect(all[0]?.volume).toBe(1)
  })

  it('never queues a chapter before its row exists', async () => {
    /**
     * The ordering that matters. Enqueueing inside the transaction would let a worker pick
     * up a chapter that is not visible yet, and with a hundred in flight those failures look
     * like a flaky importer rather than a race.
     */
    await post(body())
    expect(state.rowsAtEnqueue).toEqual([3, 3, 3])
  })

  it('spreads a backfill out instead of firing it all at once', async () => {
    // Not for our own sake — the worker serialises anyway — but so a hundred chapters do not
    // open a hundred near-simultaneous requests to the image host.
    currentManifest = manifestOf([1, 2, 3, 4, 5])
    await post(body())
    const delays = state.enqueued.map((e) => e.delayMs)
    expect(delays[0]).toBe(0)
    expect(delays.every((d, i) => i === 0 || d > (delays[i - 1] ?? 0))).toBe(true)
  })
})

describe('chapters that already exist', () => {
  const existing = async (number: number) => {
    await db
      .insert(chapters)
      .values({ seriesId: ids.series, number, state: 'published', pageCount: 12 })
  }

  it('skips one without abandoning the rest', async () => {
    // The whole reason skips are collected rather than thrown: ninety-nine chapters should
    // not be lost because one number was taken.
    await existing(2)
    const response = await post(body())
    const json = (await response.json()) as {
      data: { queued: number; skipped: Array<{ number: number }> }
    }
    expect(json.data.queued).toBe(2)
    expect(json.data.skipped.map((s) => s.number)).toEqual([2])
    expect(state.enqueued).toHaveLength(2)
  })

  it('replaces them when told to', async () => {
    await existing(2)
    const response = await post(body({ onExisting: 'replace' }))
    const json = (await response.json()) as { data: { queued: number } }
    expect(json.data.queued).toBe(3)
    expect(await rows()).toHaveLength(3)
  })

  it('refuses to replace without chapter.repair', async () => {
    await existing(2)
    state.user = user('user')
    expect((await post(body({ onExisting: 'replace' }))).status).toBe(403)
    expect(state.enqueued).toHaveLength(0)
  })

  it('treats another language as a different chapter', async () => {
    // Migration 9044: a German chapter 2 beside the English one is the point, so a manifest
    // imported as German must not collide with what is already there in English.
    await existing(2)
    const response = await post(body({ language: 'de' }))
    const json = (await response.json()) as { data: { queued: number } }
    expect(json.data.queued).toBe(3)
    expect((await rows()).filter((r) => r.language === 'de')).toHaveLength(3)
  })
})

describe('the operator’s selection', () => {
  it('imports only what was chosen', async () => {
    currentManifest = manifestOf([1, 2, 3, 4, 5])
    const response = await post(body({ only: [2, 4] }))
    const json = (await response.json()) as { data: { queued: number } }
    expect(json.data.queued).toBe(2)
    expect((await rows()).map((r) => Number(r.number))).toEqual([2, 4])
  })

  it('ignores a number that is not in the manifest', async () => {
    // Added to the file between preview and import, or simply wrong. Either way the file
    // decides what exists and the selection only narrows it.
    const response = await post(body({ only: [1, 999] }))
    const json = (await response.json()) as { data: { queued: number } }
    expect(json.data.queued).toBe(1)
  })

  it('refuses an empty selection rather than importing everything', async () => {
    expect((await post(body({ only: [] }))).status).toBe(400)
    expect(await rows()).toHaveLength(0)
  })
})

describe('permissions and targets', () => {
  it('refuses to publish on import without chapter.publish', async () => {
    state.user = user('uploader')
    expect((await post(body({ after: { mode: 'publish' } }))).status).toBe(403)
    expect(await rows()).toHaveLength(0)
  })

  it('404s for a series that does not exist', async () => {
    expect((await post(body({ seriesId: 999_999 }))).status).toBe(404)
  })

  it('stores the pages only when asked', async () => {
    await post(body({ store: 'storage' }))
    expect((await rows())[0]?.processing?.fetch?.mode).toBe('storage')
  })
})
