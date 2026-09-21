import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isBotUserAgent,
  partitionsToDrop,
  rollupWindow,
  secondsUntilNextBucket,
  shiftBucket,
  ViewBuffer,
  type ViewHit,
  viewDedupeKey,
  viewerKey,
  viewerKeyHex,
  viewPartitionBucket,
  viewPartitionName,
} from '../views.js'

const SECRET = 'test-secret'

const hit = (over: Partial<ViewHit> = {}): ViewHit => ({
  seriesId: 1,
  chapterId: 0,
  bucket: '2026-09-04',
  viewerKey: viewerKey({ bucket: '2026-09-04', visitorId: 'v-abc' }, SECRET),
  ...over,
})

describe('viewer key', () => {
  it('is stable for the same viewer and day, and 16 bytes', () => {
    const a = viewerKey({ bucket: '2026-09-04', visitorId: 'v-abc' }, SECRET)
    const b = viewerKey({ bucket: '2026-09-04', visitorId: 'v-abc' }, SECRET)
    expect(a.length).toBe(16)
    expect(viewerKeyHex(a)).toBe(viewerKeyHex(b))
  })

  it('rotates with the day, so a key is only linkable inside one bucket', () => {
    const mon = viewerKey({ bucket: '2026-09-04', visitorId: 'v-abc' }, SECRET)
    const tue = viewerKey({ bucket: '2026-09-05', visitorId: 'v-abc' }, SECRET)
    expect(viewerKeyHex(mon)).not.toBe(viewerKeyHex(tue))
  })

  it('separates viewers by visitor id, account and site secret', () => {
    const base = { bucket: '2026-09-04', visitorId: 'v-abc' }
    const keys = new Set(
      [
        viewerKey(base, SECRET),
        viewerKey({ ...base, visitorId: 'v-def' }, SECRET),
        viewerKey({ ...base, userId: 7 }, SECRET),
        viewerKey(base, 'another-secret'),
      ].map(viewerKeyHex),
    )
    expect(keys.size).toBe(4)
  })

  it('keys a signed-in reader by account, so phone and laptop are one viewer', () => {
    const phone = viewerKey({ bucket: '2026-09-04', userId: 7, visitorId: 'v-phone' }, SECRET)
    const laptop = viewerKey({ bucket: '2026-09-04', userId: 7, visitorId: 'v-laptop' }, SECRET)
    expect(viewerKeyHex(phone)).toBe(viewerKeyHex(laptop))
  })

  it('takes no address, so no stored key can be swept back to one', () => {
    // The old key was HMAC(secret, day | ip + user agent). IPv4 is 2^32 wide, so anyone
    // holding the secret could hash the whole space against one day and read every row back
    // as an address. There is no equivalent sweep for a 128-bit random cookie.
    const input: Record<string, unknown> = { bucket: '2026-09-04', visitorId: 'v-abc' }
    expect(Object.keys(input)).not.toContain('ip')
    expect(viewerKeyHex(viewerKey({ bucket: '2026-09-04', visitorId: null }, SECRET))).not.toBe(
      viewerKeyHex(viewerKey({ bucket: '2026-09-04', visitorId: 'v-abc' }, SECRET)),
    )
  })
})

describe('the dedupe rule', () => {
  it('is one viewer, one chapter, one UTC day — the view_events primary key', () => {
    const first = hit()
    expect(viewDedupeKey(first)).toBe(viewDedupeKey({ ...first }))
    expect(viewDedupeKey(first)).not.toBe(viewDedupeKey({ ...first, chapterId: 12 }))
    expect(viewDedupeKey(first)).not.toBe(viewDedupeKey({ ...first, seriesId: 2 }))
    expect(viewDedupeKey(first)).not.toBe(viewDedupeKey({ ...first, bucket: '2026-09-05' }))
  })

  it('expires exactly with the bucket', () => {
    expect(secondsUntilNextBucket(new Date('2026-09-04T00:00:00Z'))).toBe(86_400)
    expect(secondsUntilNextBucket(new Date('2026-09-04T23:59:30Z'))).toBe(30)
    expect(secondsUntilNextBucket(new Date('2026-09-04T23:59:59.500Z'))).toBeGreaterThan(0)
  })
})

describe('bot filter', () => {
  it('lets real browsers through', () => {
    for (const ua of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
    ])
      expect(isBotUserAgent(ua)).toBe(false)
  })

  it('drops crawlers, previewers, scripts and a missing user agent', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'facebookexternalhit/1.1',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
      'Mozilla/5.0 (compatible; Bytespider; https://zhanzhang.toutiao.com/)',
      'curl/8.5.0',
      'python-requests/2.32.3',
      'Go-http-client/1.1',
      'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/141.0.0.0',
      'ClaudeBot/1.0',
      null,
      '',
    ])
      expect(isBotUserAgent(ua)).toBe(true)
  })
})

describe('ViewBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes one batch per window instead of one per view', async () => {
    const batches: ViewHit[][] = []
    const buffer = new ViewBuffer({
      flush: async (rows) => {
        batches.push(rows)
      },
      maxAgeMs: 2_000,
      maxRows: 100,
    })
    for (let i = 0; i < 40; i++) buffer.add(hit({ chapterId: i + 1 }))
    expect(batches).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(40)
    expect(buffer.stats().written).toBe(40)
  })

  it('collapses duplicates that arrive inside the same window', async () => {
    const batches: ViewHit[][] = []
    const buffer = new ViewBuffer({
      flush: async (rows) => {
        batches.push(rows)
      },
      maxAgeMs: 500,
    })
    for (let i = 0; i < 10; i++) expect(buffer.add(hit())).toBe(i === 0)
    await vi.advanceTimersByTimeAsync(500)
    expect(batches[0]).toHaveLength(1)
    expect(buffer.stats().collapsed).toBe(9)
  })

  it('flushes early once the batch is full', async () => {
    const batches: ViewHit[][] = []
    const buffer = new ViewBuffer({
      flush: async (rows) => {
        batches.push(rows)
      },
      maxRows: 5,
      maxAgeMs: 60_000,
    })
    for (let i = 0; i < 12; i++) buffer.add(hit({ chapterId: i + 1 }))
    await vi.advanceTimersByTimeAsync(0)
    // the first five go at once; the seven that piled up behind the in-flight batch follow
    // it immediately rather than waiting out the 60 s window
    expect(batches.map((b) => b.length)).toEqual([5, 7])
    expect(buffer.size).toBe(0)
  })

  it('retries a failed batch once, then gives up rather than growing forever', async () => {
    let attempts = 0
    const buffer = new ViewBuffer({
      flush: async () => {
        attempts++
        throw new Error('database down')
      },
      maxAgeMs: 100,
      onError: () => undefined,
    })
    buffer.add(hit())
    await vi.advanceTimersByTimeAsync(100)
    expect(attempts).toBe(1)
    expect(buffer.size).toBe(1) // put back for one more try
    await vi.advanceTimersByTimeAsync(100)
    expect(attempts).toBe(2)
    expect(buffer.size).toBe(0)
    expect(buffer.stats().dropped).toBe(1)
    expect(buffer.stats().failures).toBe(2)
  })

  it('stops dropping once the write recovers', async () => {
    let fail = true
    const written: ViewHit[] = []
    const buffer = new ViewBuffer({
      flush: async (rows) => {
        if (fail) throw new Error('nope')
        written.push(...rows)
      },
      maxAgeMs: 50,
      onError: () => undefined,
    })
    buffer.add(hit())
    await vi.advanceTimersByTimeAsync(50)
    fail = false
    await vi.advanceTimersByTimeAsync(50)
    expect(written).toHaveLength(1)
    expect(buffer.stats().dropped).toBe(0)
  })

  it('refuses to queue past the ceiling', async () => {
    const buffer = new ViewBuffer({
      flush: async () => {
        await new Promise(() => undefined) // never resolves: the batch stays in flight
      },
      maxRows: 1_000_000,
      maxAgeMs: 60_000,
      maxQueued: 3,
    })
    for (let i = 0; i < 10; i++) buffer.add(hit({ chapterId: i + 1 }))
    expect(buffer.size).toBe(3)
    expect(buffer.stats().dropped).toBe(7)
  })
})

describe('partition lifecycle arithmetic', () => {
  it('names a partition after its UTC day, both ways', () => {
    expect(viewPartitionName('2026-09-04')).toBe('view_events_20260904')
    expect(viewPartitionName(new Date('2026-01-05T23:59:00Z'))).toBe('view_events_20260105')
    expect(viewPartitionBucket('view_events_20260105')).toBe('2026-01-05')
    expect(viewPartitionBucket('view_events_default')).toBeNull()
    expect(viewPartitionBucket('view_events')).toBeNull()
  })

  it('drops only dated partitions older than the cutoff, never the default one', () => {
    const names = [
      'view_events_20260101',
      'view_events_20260605',
      'view_events_20260606',
      'view_events_20260904',
      'view_events_default',
    ]
    // 90 days before 2026-09-04
    const cutoff = shiftBucket('2026-09-04', -90)
    expect(cutoff).toBe('2026-06-06')
    expect(partitionsToDrop(names, cutoff)).toEqual([
      'view_events_20260101',
      'view_events_20260605',
    ])
  })

  it('rolls up today plus a short tail, so the UTC midnight rollover is covered', () => {
    expect(rollupWindow(new Date('2026-09-04T00:00:10Z'))).toEqual({
      from: '2026-09-03',
      to: '2026-09-04',
    })
    expect(rollupWindow(new Date('2026-03-01T12:00:00Z'), 3)).toEqual({
      from: '2026-02-26',
      to: '2026-03-01',
    })
  })
})
