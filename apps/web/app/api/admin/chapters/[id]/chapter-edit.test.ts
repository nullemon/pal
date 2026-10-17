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
 * Renaming and renumbering a chapter.
 *
 * The route has accepted both since it was written; what it did not do was survive the
 * obvious mistake. Renumbering onto a number the series already uses reached
 * `chapters_series_number_language_unique` as an unhandled error, so the panel showed a
 * generic failure and the reason was only in the container log — for something an operator
 * does while looking at a list of chapters and typing into it.
 */

let handle: DbHandle
let db: Db
const ids = { staff: 0, series: 0, other: 0 }

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
vi.mock('@/components/admin/server/audit', () => ({
  audit: async () => undefined,
  snapshot: (row: unknown) => row,
}))
vi.mock('@/components/admin/server/cache', () => ({ purgeCatalog: () => undefined }))

const { PATCH } = await import('./route')

const patch = (id: number, body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/admin/chapters/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  )

const add = async (number: number, over: Record<string, unknown> = {}) => {
  const [row] = await db
    .insert(chapters)
    .values({ seriesId: ids.series, number, state: 'published', ...over })
    .returning({ id: chapters.id })
  return row?.id as number
}

const read = async (id: number) => {
  const [row] = await db
    .select({ number: chapters.number, title: chapters.title, volume: chapters.volume })
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
  const [a] = await db
    .insert(series)
    .values({ slug: 'a', title: 'A', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  ids.series = a?.id as number
  const [b] = await db
    .insert(series)
    .values({ slug: 'b', title: 'B', type: 'manhwa', state: 'published' })
    .returning({ id: series.id })
  ids.other = b?.id as number
}, 180_000)

afterAll(async () => {
  await handle?.close()
})

beforeEach(async () => {
  await db.delete(chapters)
  state.user = {
    id: ids.staff,
    role: 'admin',
    username: 'staff',
    email: 'staff@palscans.org',
  } as SessionUser
})

describe('PATCH /api/admin/chapters/:id', () => {
  it('renames a chapter', async () => {
    const id = await add(7, { title: 'Typo heer' })
    const res = await patch(id, { title: 'From Pawn to Knight' })
    expect(res.status).toBe(200)
    expect((await read(id))?.title).toBe('From Pawn to Knight')
  })

  it('renumbers a chapter', async () => {
    const id = await add(7)
    expect((await patch(id, { number: 8 })).status).toBe(200)
    expect((await read(id))?.number).toBe(8)
  })

  it('accepts a decimal, which is how a half chapter is numbered', async () => {
    const id = await add(7)
    expect((await patch(id, { number: 7.5 })).status).toBe(200)
    expect((await read(id))?.number).toBe(7.5)
  })

  it('clears a title back to none', async () => {
    const id = await add(7, { title: 'Remove me' })
    expect((await patch(id, { title: null })).status).toBe(200)
    expect((await read(id))?.title).toBeNull()
  })

  it('answers 409, not 500, when the number is already taken', async () => {
    await add(7)
    const id = await add(8)
    const res = await patch(id, { number: 7 })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('number_taken')
    // And the chapter is untouched, so the operator can simply retype.
    expect((await read(id))?.number).toBe(8)
  })

  it('allows a number another series uses, which is not a clash at all', async () => {
    const [mine] = await db
      .insert(chapters)
      .values({ seriesId: ids.other, number: 3, state: 'published' })
      .returning({ id: chapters.id })
    const id = await add(9)
    expect((await patch(id, { number: 3 })).status).toBe(200)
    expect((await read(mine?.id as number))?.number).toBe(3)
  })

  it('sets and clears the volume', async () => {
    const id = await add(7)
    expect((await patch(id, { volume: 2 })).status).toBe(200)
    expect((await read(id))?.volume).toBe(2)
    expect((await patch(id, { volume: null })).status).toBe(200)
    expect((await read(id))?.volume).toBeNull()
  })
})
