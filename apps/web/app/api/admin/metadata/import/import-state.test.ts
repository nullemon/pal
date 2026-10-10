import type { SessionUser } from '@palscans/core'
import { describe, expect, it, vi } from 'vitest'

/**
 * What an AniList import creates, and who may create it live.
 *
 * The draft default is a safety rule with a reason — a wrong third-party match that went
 * straight to readers is visible before anyone notices — so it is worth a test that it still
 * holds when nobody chooses, and that choosing otherwise is gated. Without the gate the
 * default is decorative: `series.create` exists so an uploader can add a title, not so they
 * can put an unreviewed match in front of readers.
 */

const state = vi.hoisted(() => ({
  user: null as unknown,
  created: [] as Array<{ state: string }>,
}))

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return {
    ...actual,
    withPermission:
      (_permission: string, handler: (r: Request, c: unknown, u: unknown) => Promise<Response>) =>
      (request: Request, ctx: unknown) =>
        handler(request, ctx, state.user),
    getRateLimiter: () => ({ hit: async () => ({ ok: true, retryAfterSec: 0 }) }),
  }
})

vi.mock('@/lib/metadata/anilist', () => ({
  metadataById: async (id: number) => ({
    ok: true as const,
    data: {
      title: `Series ${id}`,
      type: 'manga',
      status: 'ongoing',
      genres: [],
      people: [],
      altTitles: [],
    },
  }),
}))

vi.mock('@/components/admin/server/metadata', () => ({
  createSeriesFromMetadata: async (
    meta: { title: string },
    _actorId: number,
    seriesState = 'draft',
  ) => {
    state.created.push({ state: seriesState })
    return { id: state.created.length, title: meta.title, slug: 'x', unmatchedGenres: [] }
  },
}))

vi.mock('@/components/admin/server/audit', () => ({ audit: async () => undefined }))
vi.mock('@/components/admin/server/cache', () => ({ purgeCatalog: () => undefined }))

const { POST } = await import('./route')

const user = (role: SessionUser['role']): SessionUser =>
  ({ id: 1, role, username: 'staff', email: 's@palscans.org' }) as SessionUser

const post = (body: unknown) => {
  state.created = []
  return POST(
    new Request('http://localhost/api/admin/metadata/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  )
}

describe('what an import creates', () => {
  it('creates drafts when nobody says otherwise', async () => {
    state.user = user('admin')
    expect((await post({ ids: [1, 2] })).status).toBe(200)
    expect(state.created.map((c) => c.state)).toEqual(['draft', 'draft'])
  })

  it('creates published series when an admin asks', async () => {
    state.user = user('admin')
    expect((await post({ ids: [1], state: 'published' })).status).toBe(200)
    expect(state.created.map((c) => c.state)).toEqual(['published'])
  })

  it('creates unlisted series too', async () => {
    state.user = user('admin')
    await post({ ids: [1], state: 'unlisted' })
    expect(state.created.map((c) => c.state)).toEqual(['unlisted'])
  })

  it('refuses anything but draft without series.update', async () => {
    // An uploader has `series.create`, which is what this route is gated on. That must not
    // be enough to publish an unreviewed match.
    state.user = user('uploader')
    expect((await post({ ids: [1], state: 'published' })).status).toBe(403)
    expect(state.created).toHaveLength(0)
  })

  it('still lets that uploader create drafts', async () => {
    state.user = user('uploader')
    expect((await post({ ids: [1] })).status).toBe(200)
    expect(state.created.map((c) => c.state)).toEqual(['draft'])
  })

  it('refuses a state that is not a state', async () => {
    state.user = user('admin')
    expect((await post({ ids: [1], state: 'live' })).status).toBe(400)
  })
})
