import type { SessionUser } from '@palscans/core'
import {
  chapterGroups,
  chapters,
  createDb,
  type Db,
  type DbHandle,
  groups,
  runMigrations,
  series,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Crediting a whole series at once.
 *
 * The chore this removes is the reason the credit was never set: forty chapters, one group,
 * and a per-chapter picker. What is worth asserting is that it does not overreach — it must
 * not touch another series, must not resurrect deleted chapters, and must be able to credit
 * one translation without credingt the rest.
 */

let handle: DbHandle
let db: Db
const ids = { series: 0, other: 0, groupA: 0, groupB: 0 }

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
vi.mock('@/components/admin/server/audit', () => ({ audit: async () => undefined }))
vi.mock('@/components/admin/server/cache', () => ({ purgeCatalog: () => undefined }))

const { PUT } = await import('./route')

const put = (id: number, body: unknown) =>
  PUT(
    new Request(`http://localhost/api/admin/series/${id}/groups`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  )

const credits = async (seriesId: number) =>
  db
    .select({ chapterId: chapterGroups.chapterId, groupId: chapterGroups.groupId })
    .from(chapterGroups)
    .innerJoin(chapters, eq(chapters.id, chapterGroups.chapterId))
    .where(eq(chapters.seriesId, seriesId))

beforeAll(async () => {
  handle = await createDb('pglite://memory')
  db = handle.db
  await runMigrations(handle)
  const [s] = await db
    .insert(series)
    .values({ slug: 'a', title: 'A', type: 'manga', state: 'published' })
    .returning({ id: series.id })
  ids.series = s?.id ?? 0
  const [o] = await db
    .insert(series)
    .values({ slug: 'b', title: 'B', type: 'manga', state: 'published' })
    .returning({ id: series.id })
  ids.other = o?.id ?? 0
  const made = await db
    .insert(groups)
    .values([
      { slug: 'alpha', name: 'Alpha Scans' },
      { slug: 'beta', name: 'Beta Scans' },
    ])
    .returning({ id: groups.id })
  ids.groupA = made[0]?.id ?? 0
  ids.groupB = made[1]?.id ?? 0
})

afterAll(async () => {
  await handle?.close?.()
})

beforeEach(async () => {
  await db.delete(chapterGroups)
  await db.delete(chapters)
  state.user = { id: 1, role: 'admin', username: 's', email: 's@x.test' } as SessionUser
  await db.insert(chapters).values([
    { seriesId: ids.series, number: 1, language: 'en', state: 'published' },
    { seriesId: ids.series, number: 2, language: 'en', state: 'published' },
    { seriesId: ids.series, number: 1, language: 'de', state: 'published' },
    { seriesId: ids.other, number: 1, language: 'en', state: 'published' },
  ])
})

describe('crediting a series', () => {
  it('credits every chapter in one call', async () => {
    const response = await put(ids.series, { groupIds: [ids.groupA] })
    expect(response.status).toBe(200)
    const json = (await response.json()) as { data: { chapters: number } }
    expect(json.data.chapters).toBe(3)
    expect(await credits(ids.series)).toHaveLength(3)
  })

  it('leaves other series alone', async () => {
    await put(ids.series, { groupIds: [ids.groupA] })
    expect(await credits(ids.other)).toHaveLength(0)
  })

  it('credits one translation when a language is given', async () => {
    // A translated run is usually another group's work, so this has to be expressible.
    const response = await put(ids.series, { groupIds: [ids.groupB], language: 'de' })
    const json = (await response.json()) as { data: { chapters: number } }
    expect(json.data.chapters).toBe(1)
    expect(await credits(ids.series)).toHaveLength(1)
  })

  it('replaces the credit rather than adding to it', async () => {
    // The picker sends the whole answer; merging would make a wrong credit unremovable.
    await put(ids.series, { groupIds: [ids.groupA] })
    await put(ids.series, { groupIds: [ids.groupB] })
    const rows = await credits(ids.series)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.groupId === ids.groupB)).toBe(true)
  })

  it('clears the credit when given nothing, which is the only way to undo one', async () => {
    await put(ids.series, { groupIds: [ids.groupA] })
    await put(ids.series, { groupIds: [] })
    expect(await credits(ids.series)).toHaveLength(0)
  })

  it('skips deleted chapters', async () => {
    await db.update(chapters).set({ deletedAt: new Date() }).where(eq(chapters.number, 2))
    const response = await put(ids.series, { groupIds: [ids.groupA] })
    const json = (await response.json()) as { data: { chapters: number } }
    expect(json.data.chapters).toBe(2)
  })

  it('reports nothing for a series with no chapters', async () => {
    await db.delete(chapters)
    const response = await put(ids.series, { groupIds: [ids.groupA] })
    const json = (await response.json()) as { data: { chapters: number } }
    expect(json.data.chapters).toBe(0)
  })

  it('drops a group id that does not exist rather than failing the lot', async () => {
    const response = await put(ids.series, { groupIds: [ids.groupA, 999_999] })
    expect(response.status).toBe(200)
    const rows = await credits(ids.series)
    expect(rows.every((r) => r.groupId === ids.groupA)).toBe(true)
  })
})
