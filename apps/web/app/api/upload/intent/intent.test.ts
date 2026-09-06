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
import { eq, ne } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The bulk import's server-side guards, against a real Postgres (PGlite) rather than a stub
 * database. Two of the things asserted here are properties of the *database* and nothing
 * else could prove them: that a refused batch leaves no rows behind (the transaction rolls
 * back), and that the chapter numbers it would have taken are still free afterwards —
 * `chapters_series_id_number_unique` covers soft-deleted rows, so an orphan draft holds its
 * number against every later upload.
 *
 * The rest is the guard the preview exists for: a chapter number that already has pages is
 * never rebuilt because nobody said not to. `replace` is the operator's answer; without it
 * the intent refuses with 409. (docs/03 upload flow step 3–4, docs/04 "Repair".)
 */

let handle: DbHandle
let db: Db
const ids = { staff: 0, series: 0 }

const state = vi.hoisted(() => ({ user: null as unknown }))

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

vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>()
  return {
    ...actual,
    presignUpload: async () => ({
      url: 'http://localhost/api/upload/put?key=x',
      method: 'PUT' as const,
      headers: {},
    }),
  }
})

vi.mock('@/components/admin/server/audit', () => ({ audit: async () => undefined }))

const { POST } = await import('./route')

const user = (role: SessionUser['role']): SessionUser =>
  ({ id: ids.staff, role, username: 'staff', email: 'staff@palscans.org' }) as SessionUser

const sha = 'a'.repeat(64)

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/upload/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  )

const chapter = (over: Record<string, unknown> = {}) => ({
  number: 12,
  files: [{ name: '001.jpg', bytes: 1000, sha256: sha, type: 'image/jpeg' }],
  ...over,
})

/** Every chapter row the series is left holding, soft-deleted ones included. */
const rows = async () =>
  db
    .select({ number: chapters.number, state: chapters.state, pageCount: chapters.pageCount })
    .from(chapters)
    .where(eq(chapters.seriesId, ids.series))
    .orderBy(chapters.number)

type ChapterState = typeof chapters.$inferInsert.state

const existing = async (
  over: { number?: number; state?: ChapterState; pageCount?: number } = {},
) => {
  const [row] = await db
    .insert(chapters)
    .values({
      seriesId: ids.series,
      number: over.number ?? 12,
      state: over.state ?? 'published',
      pageCount: over.pageCount ?? 20,
    })
    .returning({ id: chapters.id })
  return row?.id as number
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
  const [title] = await db
    .insert(series)
    .values({ slug: 'frost', title: 'Frost', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  ids.series = title?.id as number
}, 180_000)

afterAll(async () => {
  await handle?.close()
})

beforeEach(async () => {
  await db.delete(chapters)
  state.user = user('admin')
})

describe('POST /api/upload/intent — duplicate chapter numbers', () => {
  it('creates a chapter when the number is new', async () => {
    const res = await post({ seriesId: ids.series, chapters: [chapter()] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { chapters: Array<{ replaced: boolean }> } }
    expect(body.data.chapters[0]?.replaced).toBe(false)
    expect(await rows()).toEqual([{ number: 12, state: 'draft', pageCount: 0 }])
  })

  it('refuses a chapter that already has pages when nothing said replace', async () => {
    await existing()
    for (const body of [
      { seriesId: ids.series, chapters: [chapter()] },
      { seriesId: ids.series, chapters: [chapter({ replace: false })] },
    ]) {
      const res = await post(body)
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ error: 'chapter_exists' })
    }
    expect(await rows()).toHaveLength(1)
  })

  it('replaces only when the operator asked and may repair', async () => {
    const id = await existing()
    const res = await post({ seriesId: ids.series, chapters: [chapter({ replace: true })] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { chapters: Array<{ chapterId: number; replaced: boolean; reused: boolean }> }
    }
    expect(body.data.chapters[0]).toMatchObject({ chapterId: id, replaced: true, reused: true })

    state.user = user('user')
    expect(
      (await post({ seriesId: ids.series, chapters: [chapter({ replace: true })] })).status,
    ).toBe(403)
  })

  it('reuses an empty chapter row without asking anyone', async () => {
    const id = await existing({ state: 'draft', pageCount: 0 })
    const res = await post({ seriesId: ids.series, chapters: [chapter()] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { chapters: Array<{ chapterId: number; replaced: boolean }> }
    }
    expect(body.data.chapters[0]).toMatchObject({ chapterId: id, replaced: false })
    expect(await rows()).toHaveLength(1)
  })

  it('refuses a chapter that is already processing', async () => {
    await existing({ state: 'processing', pageCount: 0 })
    const res = await post({ seriesId: ids.series, chapters: [chapter()] })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'already_processing' })
  })

  it('refuses a batch whose total exceeds the per-chapter byte cap', async () => {
    const res = await post({
      seriesId: ids.series,
      chapters: [
        chapter({
          files: Array.from({ length: 30 }, (_, i) => ({
            name: `${i}.jpg`,
            bytes: 50 * 1024 * 1024,
            sha256: sha,
            type: 'image/jpeg',
          })),
        }),
      ],
    })
    expect(res.status).toBe(413)
  })

  it('refuses a manifest the schema does not accept', async () => {
    expect((await post({ seriesId: ids.series, chapters: [] })).status).toBe(400)
    expect(
      (
        await post({
          seriesId: ids.series,
          chapters: [chapter({ files: [{ name: 'x.exe' }] })],
        })
      ).status,
    ).toBe(400)
  })
})

/**
 * One intent, one outcome. Every refusal below happens on a *later* chapter of the batch, so
 * each case only passes if the chapters accepted before it were rolled back.
 */
describe('POST /api/upload/intent — a refused batch writes nothing', () => {
  const batch = (chs: Array<Record<string, unknown>>) => ({
    seriesId: ids.series,
    chapters: chs.map((c) => chapter(c)),
  })

  it('leaves no orphan drafts when a later chapter already has pages', async () => {
    await existing({ number: 3 })
    const res = await post(batch([{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }]))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'chapter_exists' })
    // Chapters 1 and 2 were inserted before chapter 3 was refused; only the pre-existing row
    // may survive, and 1, 2 and 4 must still be free numbers.
    expect(await rows()).toEqual([{ number: 3, state: 'published', pageCount: 20 }])
  })

  it('leaves no orphan drafts when a later chapter is too large', async () => {
    const huge = {
      number: 3,
      files: Array.from({ length: 30 }, (_, i) => ({
        name: `${i}.jpg`,
        bytes: 50 * 1024 * 1024,
        sha256: sha,
        type: 'image/jpeg',
      })),
    }
    const res = await post(batch([{ number: 1 }, { number: 2 }, huge]))
    expect(res.status).toBe(413)
    expect(await rows()).toEqual([])
  })

  it('leaves no orphan drafts when a later chapter is already processing', async () => {
    await existing({ number: 3, state: 'processing', pageCount: 0 })
    const res = await post(batch([{ number: 1 }, { number: 2 }, { number: 3 }]))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'already_processing' })
    expect(await rows()).toEqual([{ number: 3, state: 'processing', pageCount: 0 }])
  })

  it('leaves no orphan drafts when a later chapter needs a repair permission this role lacks', async () => {
    await existing({ number: 3 })
    state.user = user('user')
    const res = await post(
      batch([{ number: 1 }, { number: 2 }, { number: 3, replace: true }, { number: 4 }]),
    )
    expect(res.status).toBe(403)
    expect(await rows()).toEqual([{ number: 3, state: 'published', pageCount: 20 }])
  })

  it('leaves nothing for an operator to trash, which would take the number with it', async () => {
    await existing({ number: 3 })
    expect((await post(batch([{ number: 1 }, { number: 3 }]))).status).toBe(409)
    // Trashing is the only way to get an unwanted draft out of the chapter list, and
    // `chapters_series_id_number_unique` has no `where deleted_at is null` — so a tombstoned
    // orphan keeps chapter 1's number for good. Here there is nothing to trash, and the line
    // below is a no-op; with the rows left behind it takes the number, and the retry cannot
    // insert at all.
    await db.update(chapters).set({ deletedAt: new Date() }).where(ne(chapters.number, 3))
    const retry = await post(batch([{ number: 1 }]))
    expect(retry.status).toBe(200)
    expect(await rows()).toEqual([
      { number: 1, state: 'draft', pageCount: 0 },
      { number: 3, state: 'published', pageCount: 20 },
    ])
  })
})
