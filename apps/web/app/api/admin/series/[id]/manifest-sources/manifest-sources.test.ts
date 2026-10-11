import type { SessionUser } from '@palscans/core'
import {
  createDb,
  type Db,
  type DbHandle,
  manifestSources,
  runMigrations,
  series,
  users,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Following a manifest (docs/03 "Keeping a manifest in sync").
 *
 * The route is bookkeeping, so what is worth asserting is the bookkeeping that bites:
 * following the same file twice must edit one row rather than create a second that imports
 * everything twice, the id in a PATCH or DELETE body must not be able to reach another
 * series' source, and asking for publish-on-sync must need the permission to publish.
 */

let handle: DbHandle
let db: Db
const ids = { series: 0, other: 0, staff: 0, uploader: 0 }

const state = vi.hoisted(() => ({ user: null as unknown, queued: [] as unknown[] }))

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
      state.queued.push({ name, data })
      return 'job'
    },
  }),
}))
vi.mock('@/components/admin/server/audit', () => ({ audit: async () => undefined }))

const { DELETE, GET, PATCH, POST } = await import('./route')

const url = (id: number) => `http://localhost/api/admin/series/${id}/manifest-sources`
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })
type Handler = (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>
const send = (handler: Handler, method: string, id: number, body?: unknown) =>
  handler(
    new Request(url(id), {
      method,
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    ctx(id),
  )

const MANIFEST = 'https://raw.githubusercontent.com/a/b/main/s.json'

const post = (id: number, body: unknown) => send(POST, 'POST', id, body)
const patch = (id: number, body: unknown) => send(PATCH, 'PATCH', id, body)
const remove = (id: number, body: unknown) => send(DELETE, 'DELETE', id, body)
const list = (id: number) => send(GET, 'GET', id)

const rows = async (seriesId: number) =>
  db.select().from(manifestSources).where(eq(manifestSources.seriesId, seriesId))

const dataOf = async <T>(response: Response): Promise<T> =>
  ((await response.json()) as { data: T }).data

beforeAll(async () => {
  handle = await createDb('pglite://memory')
  db = handle.db
  await runMigrations(handle)
  // Real user rows: `created_by` is a foreign key, and the panel always has a signed-in staff
  // member behind it.
  const made = await db
    .insert(users)
    .values([
      { username: 'staff', email: 'staff@palscans.org', role: 'admin' },
      { username: 'up', email: 'up@palscans.org', role: 'uploader' },
    ])
    .returning({ id: users.id })
  ids.staff = made[0]?.id ?? 0
  ids.uploader = made[1]?.id ?? 0
  const [a] = await db
    .insert(series)
    .values({ slug: 'a', title: 'A', type: 'manga', state: 'published' })
    .returning({ id: series.id })
  ids.series = a?.id ?? 0
  const [b] = await db
    .insert(series)
    .values({ slug: 'b', title: 'B', type: 'manga', state: 'published' })
    .returning({ id: series.id })
  ids.other = b?.id ?? 0
})

afterAll(async () => {
  await handle?.close?.()
})

beforeEach(async () => {
  await db.delete(manifestSources)
  state.queued = []
  state.user = {
    id: ids.staff,
    role: 'admin',
    username: 'staff',
    email: 'staff@palscans.org',
  } as SessionUser
})

describe('following a manifest', () => {
  it('stores the link with the settings the import used', async () => {
    const response = await post(ids.series, {
      url: MANIFEST,
      language: 'en',
      store: 'storage',
      publishMode: 'publish',
      group: 'Illeterate Scans',
    })
    expect(response.status).toBe(200)
    const stored = await rows(ids.series)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.url).toBe(MANIFEST)
    expect(stored[0]?.store).toBe('storage')
    expect(stored[0]?.publishMode).toBe('publish')
    expect(stored[0]?.groupName).toBe('Illeterate Scans')
    expect(stored[0]?.active).toBe(true)
  })

  it('edits the existing row when the same file is followed again', async () => {
    // Two rows would import every new chapter twice and then collide on its number.
    await post(ids.series, { url: MANIFEST, store: 'remote' })
    await post(ids.series, { url: MANIFEST, store: 'storage' })
    const stored = await rows(ids.series)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.store).toBe('storage')
  })

  it('resumes a paused source rather than leaving it paused', async () => {
    await post(ids.series, { url: MANIFEST })
    const [first] = await rows(ids.series)
    await patch(ids.series, { id: first?.id, active: false })
    await post(ids.series, { url: MANIFEST })
    expect((await rows(ids.series))[0]?.active).toBe(true)
  })

  it('keeps the same file in two languages apart', async () => {
    await post(ids.series, { url: MANIFEST, language: 'en' })
    await post(ids.series, { url: MANIFEST, language: 'de' })
    expect(await rows(ids.series)).toHaveLength(2)
  })

  it('refuses publish-on-sync without the permission to publish', async () => {
    // Otherwise an uploader could arrange for somebody else's file to publish on this site.
    state.user = {
      id: ids.uploader,
      role: 'uploader',
      username: 'up',
      email: 'up@palscans.org',
    } as SessionUser
    const response = await post(ids.series, { url: MANIFEST, publishMode: 'publish' })
    expect(response.status).toBe(403)
    expect(await rows(ids.series)).toHaveLength(0)
  })

  it('allows the same uploader to follow one that only drafts', async () => {
    state.user = {
      id: ids.uploader,
      role: 'uploader',
      username: 'up',
      email: 'up@palscans.org',
    } as SessionUser
    const response = await post(ids.series, { url: MANIFEST })
    expect(response.status).toBe(200)
    expect((await rows(ids.series))[0]?.publishMode).toBe('ready')
  })
})

describe('managing a followed manifest', () => {
  it('lists what this series follows and nothing else', async () => {
    await post(ids.series, { url: MANIFEST })
    await post(ids.other, { url: MANIFEST })
    const data = await dataOf<{ sources: Array<{ url: string }> }>(await list(ids.series))
    expect(data.sources).toHaveLength(1)
  })

  it('pauses and resumes', async () => {
    await post(ids.series, { url: MANIFEST })
    const [row] = await rows(ids.series)
    await patch(ids.series, { id: row?.id, active: false })
    expect((await rows(ids.series))[0]?.active).toBe(false)
    await patch(ids.series, { id: row?.id, active: true })
    expect((await rows(ids.series))[0]?.active).toBe(true)
  })

  it('asks the worker for a check now', async () => {
    await post(ids.series, { url: MANIFEST })
    const [row] = await rows(ids.series)
    const data = await dataOf<{ queued: boolean }>(
      await patch(ids.series, { id: row?.id, check: true }),
    )
    expect(data.queued).toBe(true)
    expect(state.queued).toEqual([{ name: 'manifest.sync', data: { sourceId: row?.id } }])
  })

  it('stops following, leaving the imported chapters alone', async () => {
    await post(ids.series, { url: MANIFEST })
    const [row] = await rows(ids.series)
    const response = await remove(ids.series, { id: row?.id })
    expect(response.status).toBe(200)
    expect(await rows(ids.series)).toHaveLength(0)
  })

  it('will not touch another series source through the id in the body', async () => {
    await post(ids.other, { url: MANIFEST })
    const [theirs] = await rows(ids.other)
    expect((await patch(ids.series, { id: theirs?.id, active: false })).status).toBe(404)
    expect((await remove(ids.series, { id: theirs?.id })).status).toBe(404)
    expect((await rows(ids.other))[0]?.active).toBe(true)
  })
})
