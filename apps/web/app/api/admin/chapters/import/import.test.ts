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
 * The gallery import endpoint.
 *
 * The parsers and the download are tested in @palscans/core and in the worker; what is left
 * here is the part only the route decides — who may import, what happens to a chapter number
 * that already exists, and that a refused import writes nothing. The last one matters most:
 * the endpoint creates a chapter row before the worker ever runs, so every refusal path has
 * to leave the series exactly as it found it. An orphan draft holds its chapter number
 * against every later upload, because the unique index covers soft-deleted rows too.
 */

let handle: DbHandle
let db: Db
const ids = { staff: 0, series: 0 }

const state = vi.hoisted(() => ({ user: null as unknown, enqueued: [] as number[] }))

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
    enqueueFetch: async (chapterId: number) => {
      state.enqueued.push(chapterId)
      return `chapter.fetch:${chapterId}:1`
    },
  }
})

/**
 * The gallery resolve, stubbed at the module boundary.
 *
 * `parseImgchestId` is deliberately left real: it is the host allowlist, and a test that
 * stubbed it away would pass while the endpoint accepted `https://evil.example/p/...`.
 */
vi.mock('@palscans/core/gallery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@palscans/core/gallery')>()
  return {
    ...actual,
    resolveGallery: async (input: string) => {
      if (input.includes('missing')) throw new actual.GalleryError('not_found', 'gone')
      return {
        provider: 'imgchest' as const,
        id: 'na7kjb9bq48',
        title: 'Gallery title',
        nsfw: false,
        images: Array.from({ length: 23 }, (_, i) => ({
          id: `f${i}`,
          link: `https://cdn.imgchest.com/files/p${i}.png`,
          position: i + 1,
        })),
      }
    },
  }
})

const { POST } = await import('./route')

const user = (role: SessionUser['role']): SessionUser =>
  ({ id: ids.staff, role, username: 'staff', email: 'staff@palscans.org' }) as SessionUser

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/admin/chapters/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  )

const body = (over: Record<string, unknown> = {}) => ({
  url: 'https://imgchest.com/p/na7kjb9bq48',
  seriesId: ids.series,
  number: 12,
  ...over,
})

const rows = async () =>
  db
    .select({
      id: chapters.id,
      number: chapters.number,
      state: chapters.state,
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
    .values({ username: 'staff', email: 'staff@palscans.org', role: 'admin' })
    .returning({ id: users.id })
  ids.staff = staff?.id ?? 0
  const [s] = await db
    .insert(series)
    .values({ slug: 'solo', title: 'Solo', type: 'manhwa', state: 'published' })
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
})

describe('a good link', () => {
  it('creates the chapter and queues the download', async () => {
    const response = await post(body())
    expect(response.status).toBe(200)
    const json = (await response.json()) as { data: { chapterId: number; pages: number } }
    expect(json.data.pages).toBe(23)
    expect(state.enqueued).toEqual([json.data.chapterId])
  })

  it('leaves the chapter in processing with no sources and the link recorded', async () => {
    // The state that says "the download has not run": the worker's marker is what makes a
    // redelivery a no-op and what tells Retry to resume a download rather than an encode.
    await post(body())
    const [row] = await rows()
    expect(row?.state).toBe('processing')
    expect(row?.processing?.sources).toEqual([])
    expect(row?.processing?.fetch).toEqual({
      url: 'https://imgchest.com/p/na7kjb9bq48',
      provider: 'imgchest',
      title: 'Gallery title',
      // Remote unless asked otherwise: a link import that filled the bucket by default
      // would be the opposite of what importing from a link is for.
      mode: 'remote',
    })
  })

  it('stores the pages only when asked', async () => {
    await post(body({ store: 'storage' }))
    expect((await rows())[0]?.processing?.fetch?.mode).toBe('storage')
  })

  it('seeds the page total so the panel shows 0 / 23, not 0 / 0', async () => {
    await post(body())
    const [row] = await rows()
    expect(row?.processing?.progress).toEqual({ done: 0, total: 23 })
  })

  it('defaults to English and takes a language when given one', async () => {
    await post(body())
    expect((await rows())[0]?.language).toBe('en')
    await db.delete(chapters)
    await post(body({ language: 'de' }))
    expect((await rows())[0]?.language).toBe('de')
  })

  it('normalises a language rather than refusing the import', async () => {
    await post(body({ language: 'DE-at' }))
    expect((await rows())[0]?.language).toBe('de')
  })

  it('rebuilds the canonical URL instead of storing what was pasted', async () => {
    await post(body({ url: 'http://www.imgchest.com/p/na7kjb9bq48?utm_source=x' }))
    expect((await rows())[0]?.processing?.fetch?.url).toBe('https://imgchest.com/p/na7kjb9bq48')
  })
})

describe('a link that is not one', () => {
  it('refuses another host without creating anything', async () => {
    // The path shape is not the credential: accepting this would make the worker fetch an
    // arbitrary origin on an operator's behalf.
    const response = await post(body({ url: 'https://evil.example/p/na7kjb9bq48' }))
    expect(response.status).toBe(400)
    expect(await rows()).toHaveLength(0)
  })

  it('refuses a host that merely ends in the right letters', async () => {
    const response = await post(body({ url: 'https://evilimgchest.com/p/na7kjb9bq48' }))
    expect(response.status).toBe(400)
    expect(await rows()).toHaveLength(0)
  })

  it('refuses a non-http scheme', async () => {
    const response = await post(body({ url: 'file:///etc/passwd' }))
    expect(response.status).toBe(400)
    expect(await rows()).toHaveLength(0)
  })

  it('creates no chapter when the gallery does not exist', async () => {
    // The gallery is resolved before the row is created precisely so this leaves no draft
    // behind for somebody to clean up by hand.
    const response = await post(body({ url: 'https://imgchest.com/p/missingaaaa' }))
    expect(response.status).toBe(404)
    expect(await rows()).toHaveLength(0)
  })
})

describe('a chapter number that already exists', () => {
  const existing = async (
    over: { pageCount?: number; state?: 'published' | 'processing' } = {},
  ) => {
    const [row] = await db
      .insert(chapters)
      .values({
        seriesId: ids.series,
        number: 12,
        state: over.state ?? 'published',
        pageCount: over.pageCount ?? 20,
      })
      .returning({ id: chapters.id })
    return row?.id as number
  }

  it('refuses rather than silently rebuilding it', async () => {
    await existing()
    const response = await post(body())
    expect(response.status).toBe(409)
    expect(state.enqueued).toEqual([])
  })

  it('replaces it when the operator says so', async () => {
    const id = await existing()
    const response = await post(body({ replace: true }))
    expect(response.status).toBe(200)
    expect(state.enqueued).toEqual([id])
    expect(await rows()).toHaveLength(1)
  })

  it('will not touch one the worker is already processing', async () => {
    await existing({ state: 'processing' })
    const response = await post(body({ replace: true }))
    expect(response.status).toBe(409)
    expect(state.enqueued).toEqual([])
  })

  it('does not collide with the same number in another language', async () => {
    // Migration 9044: a German chapter 12 beside the English one is the point of the feature,
    // so the existence check has to be per language or the import offers to replace the wrong
    // chapter.
    await existing()
    const response = await post(body({ language: 'de' }))
    expect(response.status).toBe(200)
    expect(await rows()).toHaveLength(2)
  })
})

describe('targeting an existing chapter by id', () => {
  /**
   * The page editor's route in. Series, number and language come from the chapter itself, so
   * nothing in the request can place it somewhere else — which is the point: the alternative
   * was re-deriving all three by hand into the create path and hoping they matched.
   */
  const make = async (
    over: { pageCount?: number; state?: 'published' | 'processing'; language?: string } = {},
  ) => {
    const [row] = await db
      .insert(chapters)
      .values({
        seriesId: ids.series,
        number: 12,
        state: over.state ?? 'published',
        pageCount: over.pageCount ?? 20,
        language: over.language ?? 'en',
      })
      .returning({ id: chapters.id })
    return row?.id as number
  }

  it('rebuilds that chapter without being told the series or number', async () => {
    const id = await make()
    const response = await post({ url: 'https://imgchest.com/p/na7kjb9bq48', chapterId: id })
    expect(response.status).toBe(200)
    expect(state.enqueued).toEqual([id])
    const [row] = await rows()
    expect(row?.id).toBe(id)
    expect(row?.state).toBe('processing')
    expect(row?.processing?.fetch?.url).toBe('https://imgchest.com/p/na7kjb9bq48')
  })

  it('creates no second chapter', async () => {
    const id = await make()
    await post({ url: 'https://imgchest.com/p/na7kjb9bq48', chapterId: id })
    expect(await rows()).toHaveLength(1)
  })

  it('keeps the chapter language rather than resetting it to English', async () => {
    // The request carries no language in this mode, and defaulting would silently move a
    // German chapter into the English list.
    const id = await make({ language: 'de' })
    await post({ url: 'https://imgchest.com/p/na7kjb9bq48', chapterId: id })
    expect((await rows())[0]?.language).toBe('de')
  })

  it('will not touch a chapter the worker is already processing', async () => {
    const id = await make({ state: 'processing' })
    expect((await post({ url: 'https://imgchest.com/p/na7kjb9bq48', chapterId: id })).status).toBe(
      409,
    )
    expect(state.enqueued).toEqual([])
  })

  it('needs chapter.repair, because it destroys the pages that are there', async () => {
    const id = await make()
    state.user = user('user')
    expect((await post({ url: 'https://imgchest.com/p/na7kjb9bq48', chapterId: id })).status).toBe(
      403,
    )
    expect(state.enqueued).toEqual([])
  })

  it('404s for a chapter that does not exist', async () => {
    expect(
      (await post({ url: 'https://imgchest.com/p/na7kjb9bq48', chapterId: 999_999 })).status,
    ).toBe(404)
  })

  it('still refuses an off-host link in this mode', async () => {
    const id = await make()
    expect((await post({ url: 'https://evil.example/p/na7kjb9bq48', chapterId: id })).status).toBe(
      400,
    )
    expect(state.enqueued).toEqual([])
  })

  it('refuses a request that names neither a chapter nor a series and number', async () => {
    expect((await post({ url: 'https://imgchest.com/p/na7kjb9bq48' })).status).toBe(400)
  })
})

describe('permissions', () => {
  it('lets an uploader replace pages, because that role carries chapter.repair', async () => {
    // Deliberate, not an oversight: an uploader has to be able to fix their own botched
    // upload. Asserted so that removing `chapter.repair` from the role shows up here rather
    // than as a support ticket.
    await db
      .insert(chapters)
      .values({ seriesId: ids.series, number: 12, state: 'published', pageCount: 20 })
    state.user = user('uploader')
    expect((await post(body({ replace: true }))).status).toBe(200)
  })

  it('still refuses the replace for a role without chapter.repair', async () => {
    // `withPermission('chapter.create')` is what stops a reader reaching this route at all,
    // and it is mocked out here — so this covers the branch underneath it, which is the one
    // that would be load-bearing if the role matrix ever changed.
    await db
      .insert(chapters)
      .values({ seriesId: ids.series, number: 12, state: 'published', pageCount: 20 })
    state.user = user('user')
    const response = await post(body({ replace: true }))
    expect(response.status).toBe(403)
    expect(state.enqueued).toEqual([])
  })

  it('refuses to publish on import without chapter.publish', async () => {
    state.user = user('uploader')
    const response = await post(body({ after: { mode: 'publish' } }))
    expect(response.status).toBe(403)
    expect(await rows()).toHaveLength(0)
  })

  it('lets an uploader import a new chapter as ready', async () => {
    state.user = user('uploader')
    const response = await post(body({ after: { mode: 'ready' } }))
    expect(response.status).toBe(200)
  })
})
