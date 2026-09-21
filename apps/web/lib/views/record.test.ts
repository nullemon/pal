import type { ViewHit } from '@palscans/core'
import { describe, expect, it } from 'vitest'
import type { RedisLike } from '@/lib/auth/redis'
import { VIEW_RATE_LIMIT, ViewRecorder } from './record'

/**
 * The honesty rules on the way in (docs/02 "Views and ranking"). Nothing here touches
 * Redis or Postgres: the writer is injected and the store is either the in-process
 * fallback or a tiny fake, so the rules are checked rather than the plumbing.
 */

const SECRET = 'record-test-secret'
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0'

const build = (opts: { redis?: () => Promise<RedisLike | null> } = {}) => {
  const written: ViewHit[][] = []
  const recorder = new ViewRecorder({
    write: async (rows) => {
      written.push(rows)
    },
    redis: opts.redis ?? (async () => null),
    secret: SECRET,
    maxAgeMs: 60_000, // never fires during a test; flushes are explicit
    maxRows: 1_000_000,
  })
  return { recorder, written }
}

/** The shared Redis, as the recorder uses it: `SET … NX PX` and `INCR`. */
interface FakeRedis extends Omit<RedisLike, 'set'> {
  set(k: string, v: string, mode: 'PX', ms: number, nx?: 'NX'): Promise<string | null>
}

/** A stand-in for it, with no expiry — the tests are shorter than any TTL. */
const fakeRedis = () => {
  const store = new Map<string, string>()
  const client: FakeRedis = {
    async get(k) {
      return store.get(k) ?? null
    },
    async set(k, v, _mode, _ms, nx) {
      if (nx === 'NX' && store.has(k)) return null
      store.set(k, v)
      return 'OK'
    },
    async del(...keys) {
      for (const k of keys) store.delete(k)
      return keys.length
    },
    async incr(k) {
      const n = Number(store.get(k) ?? '0') + 1
      store.set(k, String(n))
      return n
    },
    async pttl() {
      return 1000
    },
    async pexpire() {
      return 1
    },
  }
  return { client: client as unknown as RedisLike, store }
}

const viewer = { ip: '203.0.113.7', visitorId: 'visitor-one', userAgent: UA }

describe('what a counted view records about the reader', () => {
  it('stores a key that the address cannot change', async () => {
    // The guarantee the operator asked for: nothing derived from an address reaches the
    // database. Two views identical but for the address must be the same stored viewer —
    // which is also what makes them one view rather than two.
    const { recorder, written } = build()
    expect(
      await recorder.record({
        seriesId: 1,
        chapterId: 5,
        visitorId: 'v1',
        ip: '203.0.113.7',
        userAgent: UA,
      }),
    ).toBe('recorded')
    expect(
      await recorder.record({
        seriesId: 1,
        chapterId: 5,
        visitorId: 'v1',
        ip: '198.51.100.4',
        userAgent: UA,
      }),
    ).toBe('duplicate')
    await recorder.flush()
    expect(written.flat()).toHaveLength(1)
  })

  it('stores a key that the user agent cannot change either', async () => {
    // The user agent is read for the bot filter and then dropped. It used to be half the
    // viewer key, which made the same reader on two browsers two viewers.
    const { recorder } = build()
    expect(
      await recorder.record({ seriesId: 1, chapterId: 5, visitorId: 'v1', userAgent: UA }),
    ).toBe('recorded')
    expect(
      await recorder.record({ seriesId: 1, chapterId: 5, visitorId: 'v1', userAgent: 'Firefox/1' }),
    ).toBe('duplicate')
  })

  it('writes nothing but series, chapter, day and that key', async () => {
    // A row with a fifth field is a row that could hold a place. `view_events` has four
    // columns and this is the shape that fills them.
    const { recorder, written } = build()
    await recorder.record({
      seriesId: 1,
      chapterId: 5,
      visitorId: 'v1',
      ip: '203.0.113.7',
      userAgent: UA,
    })
    await recorder.flush()
    expect(Object.keys(written[0]?.[0] ?? {}).sort()).toEqual([
      'bucket',
      'chapterId',
      'seriesId',
      'viewerKey',
    ])
  })
})

describe('the dedupe rule', () => {
  it('counts one reader refreshing ten times as one view', async () => {
    const { recorder, written } = build()
    const outcomes = []
    for (let i = 0; i < 10; i++)
      outcomes.push(await recorder.record({ seriesId: 1, chapterId: 5, ...viewer }))
    expect(outcomes[0]).toBe('recorded')
    expect(outcomes.slice(1)).toEqual(Array(9).fill('duplicate'))
    await recorder.flush()
    expect(written).toHaveLength(1)
    expect(written[0]).toHaveLength(1)
  })

  it('counts each chapter of a binge separately, and the series page too', async () => {
    const { recorder, written } = build()
    for (const chapterId of [0, 1, 2, 3, 4, 5]) {
      expect(await recorder.record({ seriesId: 1, chapterId, ...viewer })).toBe('recorded')
    }
    await recorder.flush()
    expect(written[0]).toHaveLength(6)
  })

  it('lets the same reader count again the next day', async () => {
    const { recorder } = build()
    const mon = new Date('2026-09-04T22:00:00Z')
    const tue = new Date('2026-09-05T02:00:00Z')
    expect(await recorder.record({ seriesId: 1, chapterId: 5, ...viewer, now: mon })).toBe(
      'recorded',
    )
    expect(await recorder.record({ seriesId: 1, chapterId: 5, ...viewer, now: mon })).toBe(
      'duplicate',
    )
    expect(await recorder.record({ seriesId: 1, chapterId: 5, ...viewer, now: tue })).toBe(
      'recorded',
    )
  })

  it('treats two devices on one account as one viewer, and two accounts as two', async () => {
    const { recorder } = build()
    const first = { seriesId: 1, chapterId: 5, userId: 42, ip: '1.1.1.1', userAgent: UA }
    const second = { seriesId: 1, chapterId: 5, userId: 42, ip: '9.9.9.9', userAgent: 'Safari/1' }
    expect(await recorder.record(first)).toBe('recorded')
    expect(await recorder.record(second)).toBe('duplicate')
    expect(await recorder.record({ ...second, userId: 43 })).toBe('recorded')
  })

  it('dedupes across app instances when Redis is there', async () => {
    const { client } = fakeRedis()
    const a = build({ redis: async () => client })
    const b = build({ redis: async () => client })
    expect(await a.recorder.record({ seriesId: 1, chapterId: 5, ...viewer })).toBe('recorded')
    expect(await b.recorder.record({ seriesId: 1, chapterId: 5, ...viewer })).toBe('duplicate')
    await a.recorder.flush()
    await b.recorder.flush()
    expect(a.written[0]).toHaveLength(1)
    expect(b.written).toHaveLength(0)
  })

  it('falls back to counting locally when Redis is down (Postgres still refuses the duplicate)', async () => {
    const { recorder } = build({
      redis: async () => {
        throw new Error('connection refused')
      },
    })
    expect(await recorder.record({ seriesId: 1, chapterId: 5, ...viewer })).toBe('recorded')
    expect(await recorder.record({ seriesId: 1, chapterId: 5, ...viewer })).toBe('duplicate')
  })
})

describe('bots and floods', () => {
  it('never counts a crawler, and never buffers one either', async () => {
    const { recorder, written } = build()
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'curl/8.5.0',
      null,
    ])
      expect(
        await recorder.record({ seriesId: 1, chapterId: 5, ip: '1.1.1.1', userAgent: ua }),
      ).toBe('bot')
    await recorder.flush()
    expect(written).toHaveLength(0)
    expect(recorder.stats().accepted).toBe(0)
  })

  it('stops one address manufacturing views past the per-minute budget', async () => {
    const { recorder } = build()
    const outcomes: string[] = []
    for (let i = 0; i < VIEW_RATE_LIMIT + 5; i++)
      outcomes.push(await recorder.record({ seriesId: 1, chapterId: i + 1, ...viewer }))
    expect(outcomes.filter((o) => o === 'recorded')).toHaveLength(VIEW_RATE_LIMIT)
    expect(outcomes.filter((o) => o === 'rate_limited')).toHaveLength(5)
  })

  it('budgets each address separately', async () => {
    const { recorder } = build()
    for (let i = 0; i < VIEW_RATE_LIMIT + 2; i++)
      await recorder.record({ seriesId: 1, chapterId: i + 1, ...viewer })
    // A different address *and* a different browser: the budget is keyed on the address, the
    // stored viewer key on the visitor cookie, so a second reader has to differ in both to
    // be counted rather than deduped.
    expect(
      await recorder.record({
        seriesId: 1,
        chapterId: 1,
        ip: '198.51.100.4',
        visitorId: 'visitor-two',
        userAgent: UA,
      }),
    ).toBe('recorded')
  })
})

describe('the write path', () => {
  it('writes one batch for many views instead of one write each', async () => {
    const { recorder, written } = build()
    for (let i = 0; i < 250; i++)
      await recorder.record({
        seriesId: 1,
        chapterId: i + 1,
        ip: `10.0.0.${i % 200}`,
        visitorId: `visitor-${i % 200}`,
        userAgent: UA,
      })
    expect(written).toHaveLength(0) // nothing has touched the database yet
    await recorder.flush()
    expect(written).toHaveLength(1)
    expect(written[0]?.length).toBe(recorder.stats().written)
  })

  it('hands the writer exactly what view_events needs', async () => {
    const { recorder, written } = build()
    await recorder.record({
      seriesId: 12,
      chapterId: 34,
      ...viewer,
      now: new Date('2026-09-04T10:00:00Z'),
    })
    await recorder.flush()
    const row = written[0]?.[0]
    expect(row?.seriesId).toBe(12)
    expect(row?.chapterId).toBe(34)
    expect(row?.bucket).toBe('2026-09-04')
    expect(row?.viewerKey).toHaveLength(16)
  })
})
