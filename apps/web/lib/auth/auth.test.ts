import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseHibpRange } from './hibp'
import { MAX_JSON_BYTES, parseJson, readBody } from './http'
import { accountKey, clientIp, createMemoryRateLimiter, ipKey } from './rate-limit'
import { safeReturnPath, withReturn } from './return-to'
import { signValue, verifyValue } from './signed'

const headers = (h: Record<string, string>) => new Request('http://x/', { headers: h })

describe('clientIp', () => {
  const forged = { 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'x-real-ip': '203.0.113.9' }
  it('trusts no header when no proxy is configured', () => {
    expect(clientIp(headers(forged), { mode: 'none', hops: 1 })).toBeNull()
  })
  it('takes the hop the trusted proxy appended (the last), never the client-supplied first one', () => {
    expect(clientIp(headers(forged), { mode: 'xff', hops: 1 })).toBe('203.0.113.9')
    expect(
      clientIp(headers({ 'x-forwarded-for': '6.6.6.6, 10.0.0.2, 203.0.113.9' }), {
        mode: 'xff',
        hops: 1,
      }),
    ).toBe('203.0.113.9')
    expect(
      clientIp(headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.2' }), {
        mode: 'xff',
        hops: 2,
      }),
    ).toBe('203.0.113.9')
    expect(clientIp(headers({ 'x-real-ip': '198.51.100.4' }), { mode: 'xff', hops: 1 })).toBe(
      '198.51.100.4',
    )
    expect(clientIp(headers({}), { mode: 'xff', hops: 1 })).toBeNull()
  })
  it('prefers cf-connecting-ip behind Cloudflare and accepts a Headers object', () => {
    const h = new Headers({ ...forged, 'cf-connecting-ip': '198.51.100.7' })
    expect(clientIp(h, { mode: 'cloudflare', hops: 1 })).toBe('198.51.100.7')
    expect(clientIp(headers(forged), { mode: 'cloudflare', hops: 1 })).toBe('203.0.113.9')
  })
})

describe('rate-limit keys', () => {
  const ip = '203.0.113.9'
  it('ipKey never contains the address and rotates daily', () => {
    const a = ipKey(ip, new Date('2026-09-02T10:00:00Z'), 's')
    const b = ipKey(ip, new Date('2026-09-02T23:59:00Z'), 's')
    const c = ipKey(ip, new Date('2026-09-03T00:01:00Z'), 's')
    expect(a).toMatch(/^[a-f0-9]{32}$/)
    expect(a).not.toContain('203')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(ipKey(ip, new Date('2026-09-02T10:00:00Z'), 'other')).not.toBe(a)
    // no address → no key, so callers skip the IP bucket instead of sharing one
    expect(ipKey(null, new Date('2026-09-02T10:00:00Z'), 's')).toBeNull()
  })
  it('accountKey is keyed by the secret, rotates daily and never contains the address', () => {
    const email = 'Reader@Example.org'
    const a = accountKey(email, new Date('2026-09-02T10:00:00Z'), 's')
    const b = accountKey(email, new Date('2026-09-02T23:59:00Z'), 's')
    const c = accountKey(email, new Date('2026-09-03T00:01:00Z'), 's')
    expect(a).toMatch(/^[a-f0-9]{32}$/)
    expect(a.toLowerCase()).not.toContain('reader')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    // not a bare digest of the address: the secret is part of the key
    expect(accountKey(email, new Date('2026-09-02T10:00:00Z'), 'other')).not.toBe(a)
    // the same account spelled differently shares one bucket
    expect(accountKey(' reader@example.org ', new Date('2026-09-02T10:00:00Z'), 's')).toBe(a)
    expect(accountKey('other@example.org', new Date('2026-09-02T10:00:00Z'), 's')).not.toBe(a)
  })
})

describe('readBody', () => {
  const streamOf = (chunks: Uint8Array[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c)
        controller.close()
      },
    })
  const post = (body: BodyInit | null, h: Record<string, string> = {}) =>
    new Request('http://x/', {
      method: 'POST',
      body,
      headers: h,
      // @ts-expect-error duplex is required by undici for stream bodies
      duplex: 'half',
    })
  it('refuses a declared Content-Length over the cap before reading', async () => {
    const r = await readBody(post('abc', { 'content-length': '999' }), 10)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(413)
  })
  it('cuts a chunked body off the moment it passes the cap', async () => {
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(1024))
      },
    })
    const r = await readBody(post(endless), 4096)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(413)
    expect(pulled).toBeLessThan(20)
  })
  it('reads a body within the cap and can demand a Content-Length', async () => {
    const ok = await readBody(post(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])])), 10)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect([...ok.body]).toEqual([1, 2, 3])
    const missing = await readBody(post(streamOf([new Uint8Array([1])])), 10, {
      requireLength: true,
    })
    expect(missing.ok).toBe(false)
  })
  it('parseJson caps at MAX_JSON_BYTES and still parses normal bodies', async () => {
    const schema = z.object({ a: z.number() })
    const good = await parseJson(post(JSON.stringify({ a: 1 })), schema)
    expect(good.ok).toBe(true)
    const big = await parseJson(post(`{"a":"${'x'.repeat(MAX_JSON_BYTES)}"}`), schema)
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.response.status).toBe(413)
    const bad = await parseJson(post('{'), schema)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.response.status).toBe(400)
  })
})

describe('safeReturnPath', () => {
  it('keeps same-origin paths and drops everything else', () => {
    expect(safeReturnPath('/series/solo-leveling/chapter-3')).toBe(
      '/series/solo-leveling/chapter-3',
    )
    expect(safeReturnPath('/me/bookmarks?status=reading')).toBe('/me/bookmarks?status=reading')
    expect(safeReturnPath('https://evil.example/')).toBe('/')
    expect(safeReturnPath('//evil.example/')).toBe('/')
    expect(safeReturnPath('/\\evil.example')).toBe('/')
    expect(safeReturnPath('/login?return=/x')).toBe('/')
    expect(safeReturnPath('/api/auth/logout')).toBe('/')
    expect(safeReturnPath(undefined, '/me')).toBe('/me')
  })
  it('appends return only when it is not the root', () => {
    expect(withReturn('/register', '/')).toBe('/register')
    expect(withReturn('/register', '/me', { gate: 'premium' })).toBe(
      '/register?gate=premium&return=%2Fme',
    )
  })
})

describe('signed values', () => {
  const schema = z.object({ u: z.number(), exp: z.number() })
  it('round-trips and rejects tampering or expiry', () => {
    const now = Date.now()
    const raw = signValue({ u: 7, exp: now + 1000 }, 'secret')
    expect(verifyValue(raw, schema, 'secret', now)).toEqual({ u: 7, exp: now + 1000 })
    expect(verifyValue(raw, schema, 'other', now)).toBeNull()
    expect(verifyValue(`${raw}x`, schema, 'secret', now)).toBeNull()
    expect(verifyValue(raw, schema, 'secret', now + 2000)).toBeNull()
    expect(verifyValue(undefined, schema, 'secret', now)).toBeNull()
  })
})

describe('rate limiter', () => {
  it('counts hits in a window and backs off exponentially', async () => {
    let t = 0
    const limiter = createMemoryRateLimiter(() => t)
    for (let i = 0; i < 5; i++) expect((await limiter.hit('k', 5, 60)).ok).toBe(true)
    expect((await limiter.hit('k', 5, 60)).ok).toBe(false)
    t += 61_000
    expect((await limiter.hit('k', 5, 60)).ok).toBe(true)

    for (let i = 0; i < 5; i++) await limiter.hitWithBackoff('login', 5, 60)
    const first = await limiter.hitWithBackoff('login', 5, 60)
    expect(first.ok).toBe(false)
    expect(first.retryAfterSec).toBe(60)
    t += 61_000
    for (let i = 0; i < 5; i++) await limiter.hitWithBackoff('login', 5, 60)
    const second = await limiter.hitWithBackoff('login', 5, 60)
    expect(second.retryAfterSec).toBe(120)
    await limiter.clear('login')
    expect((await limiter.hitWithBackoff('login', 5, 60)).ok).toBe(true)
  })
})

describe('hibp', () => {
  it('finds the suffix in a range response', () => {
    const body =
      '0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2\r\n'
    expect(parseHibpRange(body, '00D4F6E8FA6EECAD2A3AA415EEC418D38EC')).toBe(2)
    expect(parseHibpRange(body, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')).toBe(0)
  })
})
