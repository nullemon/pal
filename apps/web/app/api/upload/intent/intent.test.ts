import type { SessionUser } from '@palscans/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The bulk import's server-side guard: a chapter number that already has pages is never
 * rebuilt because nobody said not to. The preview asks the operator, and `replace` is that
 * answer — without it the intent refuses with 409 rather than quietly overwriting a
 * published chapter's pages. (docs/03 upload flow step 3–4, docs/04 "Repair".)
 */

const state = vi.hoisted(() => ({
  user: null as unknown,
  series: [{ id: 1 }] as Array<{ id: number }>,
  existing: [] as Array<{ id: number; state: string; pageCount: number }>,
  inserted: 0,
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
  let table: unknown = null
  const chain = {
    from: (t: unknown) => {
      table = t
      return chain
    },
    where: () => chain,
    limit: async () => (table === actual.series ? state.series : state.existing),
  }
  const db = {
    select: () => chain,
    insert: () => ({
      values: () => ({
        returning: async () => {
          state.inserted += 1
          return [{ id: 900 + state.inserted }]
        },
      }),
    }),
  }
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
  ({ id: 7, role, username: 'staff', email: 'staff@palscans.org' }) as SessionUser

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

beforeEach(() => {
  state.user = user('admin')
  state.series = [{ id: 1 }]
  state.existing = []
  state.inserted = 0
})

describe('POST /api/upload/intent — duplicate chapter numbers', () => {
  it('creates a chapter when the number is new', async () => {
    const res = await post({ seriesId: 1, chapters: [chapter()] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { chapters: Array<{ replaced: boolean }> } }
    expect(body.data.chapters[0]?.replaced).toBe(false)
    expect(state.inserted).toBe(1)
  })

  it('refuses a chapter that already has pages when nothing said replace', async () => {
    state.existing = [{ id: 42, state: 'published', pageCount: 20 }]
    for (const body of [
      { seriesId: 1, chapters: [chapter()] },
      { seriesId: 1, chapters: [chapter({ replace: false })] },
    ]) {
      const res = await post(body)
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ error: 'chapter_exists' })
    }
    expect(state.inserted).toBe(0)
  })

  it('replaces only when the operator asked and may repair', async () => {
    state.existing = [{ id: 42, state: 'published', pageCount: 20 }]
    const res = await post({ seriesId: 1, chapters: [chapter({ replace: true })] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { chapters: Array<{ chapterId: number; replaced: boolean; reused: boolean }> }
    }
    expect(body.data.chapters[0]).toMatchObject({ chapterId: 42, replaced: true, reused: true })

    state.user = user('user')
    expect((await post({ seriesId: 1, chapters: [chapter({ replace: true })] })).status).toBe(403)
  })

  it('reuses an empty chapter row without asking anyone', async () => {
    state.existing = [{ id: 42, state: 'draft', pageCount: 0 }]
    const res = await post({ seriesId: 1, chapters: [chapter()] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { chapters: Array<{ chapterId: number; replaced: boolean }> }
    }
    expect(body.data.chapters[0]).toMatchObject({ chapterId: 42, replaced: false })
  })

  it('refuses a chapter that is already processing', async () => {
    state.existing = [{ id: 42, state: 'processing', pageCount: 0 }]
    const res = await post({ seriesId: 1, chapters: [chapter()] })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'already_processing' })
  })

  it('refuses a batch whose total exceeds the per-chapter byte cap', async () => {
    const res = await post({
      seriesId: 1,
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
    expect((await post({ seriesId: 1, chapters: [] })).status).toBe(400)
    expect(
      (await post({ seriesId: 1, chapters: [chapter({ files: [{ name: 'x.exe' }] })] })).status,
    ).toBe(400)
  })
})
