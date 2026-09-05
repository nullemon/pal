import type { SessionUser } from '@palscans/core'
import type { Db } from '@palscans/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/reports/chapter — the guards around an endpoint an anonymous stranger may call.
 *
 * The limit is the whole reason this route can be open at all: without it "anyone may
 * report a chapter" reads as "anyone may write rows into the moderation queue as fast as
 * they can loop". So the budget, whose budget it is, and what happens on the sixth attempt
 * are tested here rather than assumed.
 */

interface QueryState {
  user: SessionUser | null
  chapter: Record<string, unknown> | null
  duplicate: { id: number } | null
  inserted: Array<Record<string, unknown>>
  ip: string | null
  now: number
}

const state = vi.hoisted(
  (): QueryState => ({
    user: null,
    chapter: null,
    duplicate: null,
    inserted: [],
    ip: '203.0.113.7',
    now: 1_800_000_000_000,
  }),
)

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>()
  return { ...actual, getSessionUser: async () => state.user }
})

vi.mock('@/lib/auth/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/rate-limit')>()
  // One limiter for the whole file, on a clock the tests move: a fixed window cannot be
  // "reset", so each test starts by stepping past the previous one's hour.
  const limiter = actual.createMemoryRateLimiter(() => state.now)
  return {
    ...actual,
    getRateLimiter: () => limiter,
    clientIp: () => state.ip,
    ipKey: (ip: string | null) => (ip ? `k:${ip}` : null),
  }
})

vi.mock('@palscans/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@palscans/db')>()

  const select = () => {
    let joined = false
    const chain = {
      from: () => chain,
      // Only the chapter lookup joins; the dedupe probe does not.
      innerJoin: () => {
        joined = true
        return chain
      },
      where: () => chain,
      orderBy: () => chain,
      limit: async () =>
        joined ? (state.chapter ? [state.chapter] : []) : state.duplicate ? [state.duplicate] : [],
    }
    return chain
  }

  const insert = () => {
    let values: Record<string, unknown> = {}
    const chain = {
      values: (v: Record<string, unknown>) => {
        values = v
        return chain
      },
      returning: async () => {
        state.inserted.push(values)
        return [{ id: 1000 + state.inserted.length }]
      },
    }
    return chain
  }

  const db = { select, insert } as unknown as Db
  return { ...actual, getDb: async () => db }
})

const { POST } = await import('./route')

const chapter = {
  id: 42,
  number: '301',
  title: 'The winter gate',
  pageCount: 24,
  seriesId: 7,
  seriesSlug: 'frost-monarch',
  seriesTitle: 'Frost Monarch',
}

const post = (
  body: Record<string, unknown>,
  headers: Record<string, string> = { origin: 'http://localhost:3000' },
) =>
  POST(
    new Request('http://localhost:3000/api/reports/chapter', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )

const report = { chapterId: 42, reason: 'missing_page', pageIdx: 6 }

beforeEach(() => {
  state.user = null
  state.chapter = chapter
  state.duplicate = null
  state.inserted = []
  state.ip = '203.0.113.7'
  // Past every window the previous test opened.
  state.now += 7_200_000
})

describe('what a signed-out reader can file', () => {
  it('files the report with the context a moderator needs to act', async () => {
    const res = await post({ ...report, note: '  page 7 repeats page 6  ' })
    expect(res.status).toBe(200)
    const row = state.inserted[0]
    expect(row).toMatchObject({
      kind: 'broken_chapter',
      targetType: 'chapter',
      targetId: 42,
      reporterId: null,
      reason: 'missing_page',
      detail: 'page 7 repeats page 6',
    })
    expect(row?.payload).toMatchObject({
      series: 'Frost Monarch',
      series_slug: 'frost-monarch',
      series_id: 7,
      chapter_id: 42,
      chapter_number: 301,
      page: 7, // 1-based, the number the reader saw — not the array index
      page_count: 24,
      signed_in: false,
      href: '/series/frost-monarch/chapter-301',
    })
    // The address itself is never stored, only its rotating HMAC (docs/14 §6).
    expect(row?.ipHash).toBeInstanceOf(Uint8Array)
  })

  it('accepts a report with no note and no page at all', async () => {
    const res = await post({ chapterId: 42, reason: 'other' })
    expect(res.status).toBe(200)
    expect(state.inserted[0]).toMatchObject({ detail: null })
    expect(state.inserted[0]?.payload).toMatchObject({ page: null })
  })

  it('refuses a reason nobody offered', async () => {
    const res = await post({ chapterId: 42, reason: 'i_just_do_not_like_it' })
    expect(res.status).toBe(400)
    expect(state.inserted).toHaveLength(0)
  })

  it('answers a chapter that is gone or unpublished exactly like a missing one', async () => {
    state.chapter = null
    expect((await post(report)).status).toBe(404)
    expect(state.inserted).toHaveLength(0)
  })

  it('refuses a cross-site POST (docs/07 Origin check)', async () => {
    const res = await post(report, { origin: 'https://not-palscans.example' })
    expect(res.status).toBe(403)
    expect(state.inserted).toHaveLength(0)
  })
})

describe('the rate limit', () => {
  it('takes five reports an hour from one address and then refuses', async () => {
    for (let i = 0; i < 5; i++) {
      // Each is about a different chapter, so the dedupe never fires and the limit is
      // demonstrably what stops the sixth.
      state.chapter = { ...chapter, id: 100 + i }
      expect((await post({ ...report, chapterId: 100 + i })).status).toBe(200)
    }
    state.chapter = { ...chapter, id: 200 }
    const sixth = await post({ ...report, chapterId: 200 })
    expect(sixth.status).toBe(429)
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await sixth.json()).toMatchObject({ error: 'rate_limited' })
    expect(state.inserted).toHaveLength(5)
  })

  it('opens again in the next window', async () => {
    for (let i = 0; i < 6; i++) {
      state.chapter = { ...chapter, id: 300 + i }
      await post({ ...report, chapterId: 300 + i })
    }
    expect(state.inserted).toHaveLength(5)
    state.now += 3_600_001
    state.chapter = { ...chapter, id: 399 }
    expect((await post({ ...report, chapterId: 399 })).status).toBe(200)
  })

  it('is per address — one abuser cannot mute everyone else', async () => {
    for (let i = 0; i < 6; i++) {
      state.chapter = { ...chapter, id: 400 + i }
      await post({ ...report, chapterId: 400 + i })
    }
    expect(state.inserted).toHaveLength(5)
    state.ip = '198.51.100.9'
    state.chapter = { ...chapter, id: 500 }
    expect((await post({ ...report, chapterId: 500 })).status).toBe(200)
  })

  it('gives a signed-in reporter their own budget, keyed by account', async () => {
    state.user = { id: 12, role: 'user' } as SessionUser
    for (let i = 0; i < 10; i++) {
      state.chapter = { ...chapter, id: 600 + i }
      expect((await post({ ...report, chapterId: 600 + i })).status).toBe(200)
    }
    state.chapter = { ...chapter, id: 700 }
    expect((await post({ ...report, chapterId: 700 })).status).toBe(429)
    expect(state.inserted[0]).toMatchObject({ reporterId: 12 })
    expect(state.inserted[0]?.payload).toMatchObject({ signed_in: true })
  })

  it('counts a duplicate against the budget but does not write a second row', async () => {
    state.duplicate = { id: 555 }
    const res = await post(report)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ data: { id: 555 } })
    expect(state.inserted).toHaveLength(0)
  })
})
