import type { Db } from '@palscans/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppUser } from '@/lib/comments/viewer'
import { GET } from './route'

type CommentRow = NonNullable<
  Awaited<ReturnType<typeof import('@/lib/comments/queries').getCommentRow>>
>
type ReactorRow = {
  kind: string
  id: number
  username: string | null
  displayName: string | null
  avatarKey: string | null
}

const state = vi.hoisted(() => ({
  user: null as unknown,
  row: null as unknown,
  rows: [] as ReactorRow[],
  queries: 0,
}))

vi.mock('@/lib/comments/viewer', () => ({ getAppUser: async () => state.user }))
vi.mock('@/lib/comments/queries', () => ({ getCommentRow: async () => state.row }))
vi.mock('@palscans/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@palscans/db')>()
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: async () => {
      state.queries++
      return state.rows
    },
  }
  return { ...actual, db: { select: () => chain } as unknown as Db }
})

const user = (over: Partial<AppUser> = {}): AppUser => ({
  id: 1,
  role: 'user',
  username: 'reader',
  email: 'reader@example.org',
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  displayName: null,
  avatarKey: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  commentBannedUntil: null,
  entitlements: [],
  ...over,
})

const row = (over: Partial<CommentRow> = {}): CommentRow => ({
  id: 7,
  userId: 2,
  seriesId: 1,
  chapterId: null,
  parentId: null,
  body: { type: 'doc', version: 1, children: [] },
  isSpoiler: false,
  isPinned: false,
  score: 0,
  status: 'published',
  imageId: null,
  locked: false,
  reactionCounts: {},
  replyCount: 0,
  editedAt: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  deletedAt: null,
  ...over,
})

const call = (id = '7') =>
  GET(new Request(`http://localhost:3000/api/comments/${id}/reactors`), {
    params: Promise.resolve({ id }),
  })

describe('GET /api/comments/:id/reactors — visibility guard', () => {
  beforeEach(() => {
    state.user = user({ role: 'admin' })
    state.row = row()
    state.rows = []
    state.queries = 0
  })

  it('answers 404 for held comments, even to staff, without reading reactions', async () => {
    for (const status of ['pending', 'shadow', 'rejected'] as const) {
      state.row = row({ status })
      expect((await call()).status).toBe(404)
    }
    expect(state.queries).toBe(0)
  })

  it('answers 404 for deleted and missing comments', async () => {
    state.row = row({ deletedAt: new Date() })
    expect((await call()).status).toBe(404)
    state.row = null
    expect((await call()).status).toBe(404)
    expect((await call('x')).status).toBe(404)
    expect(state.queries).toBe(0)
  })

  it('never lets the 403 / 404 split enumerate held comments', async () => {
    state.user = user()
    state.row = row({ status: 'pending' })
    expect((await call()).status).toBe(404)
    state.row = row()
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('premium_required')
    expect(state.queries).toBe(0)
  })

  it('lists the reactors of a published comment for staff and Premium', async () => {
    state.rows = [{ kind: 'up', id: 3, username: 'fan', displayName: null, avatarKey: null }]
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).data.reactors).toEqual([
      { kind: 'up', id: 3, username: 'fan', displayName: 'fan', avatarUrl: null },
    ])
    state.user = user({ entitlements: [{ feature: 'premium_content', expires_at: null }] })
    expect((await call()).status).toBe(200)
    expect(state.queries).toBe(2)
  })
})
