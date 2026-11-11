import type { SessionUser } from '@palscans/core'
import {
  type ChapterProcessing,
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
 * Pulling a remote chapter's pages into our own bucket.
 *
 * A chapter imported in remote mode holds no pages of ours: `/p/:chapter/:idx` fetches each
 * image from the host it came from and stores nothing. The cost lands on the operator as an
 * empty page grid — a single bad page cannot be replaced, nothing can be watermarked — and
 * on the site as a catalogue that stops working the day the other host does.
 *
 * Converting one chapter was always possible through the import panel's storage toggle. What
 * made that useless in practice is that the decision is never about one chapter: it is a
 * series, or everything, and re-pasting a link per chapter is a job nobody finishes.
 *
 * The three cases below are the ones that decide whether the bulk action is safe to point at
 * a whole catalogue: it must convert what it can, refuse to touch a chapter mid-download, and
 * leave a chapter that is already ours completely alone rather than re-downloading it.
 */

let handle: DbHandle
let db: Db
const ids = { staff: 0, series: 0 }
const queued: Array<{ name: string; data: unknown }> = []

const state = vi.hoisted(() => ({ user: null as unknown }))

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return {
    ...actual,
    withPermission:
      (_p: string, handler: (r: Request, c: unknown, u: unknown) => Promise<Response>) =>
      (request: Request, ctx: unknown) =>
        handler(request, ctx, state.user),
  }
})
vi.mock('@palscans/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@palscans/db')>()
  return { ...actual, getDb: async () => db }
})
vi.mock('@palscans/core/queue', () => ({
  getQueue: async () => ({
    add: async (name: string, data: unknown) => {
      queued.push({ name, data })
      return 'job-1'
    },
  }),
}))
vi.mock('@/components/admin/server/audit', () => ({
  audit: async () => undefined,
  snapshot: (row: unknown) => row,
}))
vi.mock('@/components/admin/server/cache', () => ({ purgeCatalog: () => undefined }))

const { POST } = await import('./route')

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/admin/chapters/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  )

/** A chapter as the import panel leaves it: the descriptor is the record of where pages live. */
const remoteDoc = (over: Partial<ChapterProcessing> = {}): ChapterProcessing => ({
  sources: [],
  results: {},
  progress: { done: 12, total: 12 },
  errors: {},
  attempt: 1,
  mode: 'all',
  fetch: {
    url: 'https://imgchest.com/p/abcdefghijk',
    provider: 'imgchest',
    title: 'Chapter 1',
    mode: 'remote',
  },
  after: { isPremium: false, publishedAt: '2026-01-01T00:00:00.000Z' },
  startedAt: null,
  finishedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const add = async (number: number, over: Record<string, unknown> = {}) => {
  const [row] = await db
    .insert(chapters)
    .values({
      seriesId: ids.series,
      number,
      state: 'published',
      processing: remoteDoc(),
      pageCount: 12,
      ...over,
    })
    .returning({ id: chapters.id })
  return row?.id as number
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
  handle = await createDb('pglite://memory')
  db = handle.db
  await runMigrations(handle)
  const [staff] = await db
    .insert(users)
    .values({ email: 'staff@palscans.org', username: 'staff' })
    .returning({ id: users.id })
  ids.staff = staff?.id as number
  const [s] = await db
    .insert(series)
    .values({ slug: 'a', title: 'A', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  ids.series = s?.id as number
})

afterAll(async () => {
  await handle.close()
})

beforeEach(async () => {
  await db.delete(chapters)
  queued.length = 0
  state.user = {
    id: ids.staff,
    role: 'admin',
    permissions: ['chapter.update', 'chapter.repair'],
  } as unknown as SessionUser
})

describe('copy_to_storage', () => {
  it('flips the descriptor to storage and queues the download', async () => {
    const id = await add(1)
    const res = await post({ action: 'copy_to_storage', ids: [id] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { affected: number[]; skipped: unknown[] } }
    expect(body.data.affected).toEqual([id])
    expect(body.data.skipped).toEqual([])

    const row = await read(id)
    expect(row?.processing?.fetch?.mode).toBe('storage')
    // The link itself is untouched: it is the only record of where these pages come from.
    expect(row?.processing?.fetch?.url).toBe('https://imgchest.com/p/abcdefghijk')
    expect(row?.state).toBe('processing')
    // A fresh attempt, or BullMQ dedupes the job against the one that already ran.
    expect(row?.processing?.attempt).toBe(2)
    expect(queued).toEqual([{ name: 'chapter.fetch', data: { chapterId: id } }])
  })

  it('carries the publish state through, so a live chapter comes back live', async () => {
    // The conversion runs over a published back catalogue. Losing `after` here would quietly
    // unpublish every chapter it touched, and nobody would see it until a reader did.
    const id = await add(2)
    await post({ action: 'copy_to_storage', ids: [id] })
    const row = await read(id)
    expect(row?.processing?.after).toEqual({
      isPremium: false,
      publishedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('leaves a chapter whose pages are already ours completely alone', async () => {
    /*
     * The absence of a `fetch` descriptor is the signal, and it is not a guess: the fetch job
     * deletes it when it finishes in storage mode and keeps it when it finishes in remote
     * mode, and a browser upload never had one. So no descriptor means the pages are in the
     * bucket by one route or the other — re-downloading would cost a full chapter of
     * bandwidth to arrive back where it started.
     */
    const ours = await add(3, { processing: { ...remoteDoc(), fetch: undefined } })
    const res = await post({ action: 'copy_to_storage', ids: [ours] })
    const body = (await res.json()) as {
      data: { affected: number[]; skipped: Array<{ id: number; reason: string }> }
    }
    expect(body.data.affected).toEqual([])
    expect(body.data.skipped).toEqual([{ id: ours, reason: 'already_ours' }])
    expect(queued).toEqual([])
    expect((await read(ours))?.state).toBe('published')
  })

  it('refuses a chapter that is mid-download rather than overwriting it', async () => {
    // Its document belongs to a job that is running right now; rewriting it underneath that
    // job is how a chapter ends up half converted with no way to tell.
    const busy = await add(4, { state: 'processing' })
    const res = await post({ action: 'copy_to_storage', ids: [busy] })
    const body = (await res.json()) as {
      data: { affected: number[]; skipped: Array<{ id: number; reason: string }> }
    }
    expect(body.data.skipped).toEqual([{ id: busy, reason: 'processing' }])
    expect(queued).toEqual([])
  })

  it('converts what it can and reports the rest, over a mixed selection', async () => {
    // The realistic call: an operator selects everything in a series and presses the button.
    const a = await add(5)
    const b = await add(6)
    const ours = await add(7, { processing: { ...remoteDoc(), fetch: undefined } })
    const busy = await add(8, { state: 'processing' })
    const res = await post({ action: 'copy_to_storage', ids: [a, b, ours, busy] })
    const body = (await res.json()) as {
      data: { affected: number[]; skipped: Array<{ id: number; reason: string }> }
    }
    expect(body.data.affected.sort()).toEqual([a, b].sort())
    expect(body.data.skipped.map((s) => s.reason).sort()).toEqual(['already_ours', 'processing'])
    expect(queued).toHaveLength(2)
  })

  it('needs chapter.repair, not just chapter.update', async () => {
    // It discards a chapter's pages and downloads them again: that is repair, and the same
    // bar the single-chapter path in the page editor holds.
    const id = await add(9)
    state.user = {
      id: ids.staff,
      role: 'uploader',
      permissions: ['chapter.update'],
    } as unknown as SessionUser
    const res = await post({ action: 'copy_to_storage', ids: [id] })
    expect(res.status).toBe(403)
    expect(queued).toEqual([])
  })
})
