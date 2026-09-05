import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cachedCard,
  cardCacheControl,
  cardCacheSize,
  clearCardCache,
  notModified,
} from './og-cache'

/**
 * The cache is the whole reason the card endpoint is safe to expose: a link pasted into a
 * busy Discord server arrives as a burst of identical requests, and rasterising per request
 * would be a self-inflicted denial of service. These tests pin the two properties that make
 * that true — one render per key, and no repeat render after the first.
 */

const bytes = (n: number) => new Uint8Array(n).fill(1)

beforeEach(() => {
  clearCardCache()
})

describe('cachedCard', () => {
  it('renders once and serves the rest from memory', async () => {
    const render = vi.fn(async () => bytes(8))
    const first = await cachedCard('k', render)
    const second = await cachedCard('k', render)
    expect(render).toHaveBeenCalledTimes(1)
    expect(second.bytes).toBe(first.bytes)
    expect(cardCacheSize()).toBe(1)
  })

  it('collapses a burst of identical requests into one render', async () => {
    let resolve: (v: Uint8Array) => void = () => {}
    const pending = new Promise<Uint8Array>((r) => {
      resolve = r
    })
    const render = vi.fn(() => pending)
    const all = Promise.all(Array.from({ length: 25 }, () => cachedCard('k', render)))
    resolve(bytes(8))
    const results = await all
    expect(render).toHaveBeenCalledTimes(1)
    expect(new Set(results.map((r) => r.etag)).size).toBe(1)
  })

  it('keeps separate keys apart', async () => {
    await cachedCard('a', async () => bytes(8))
    await cachedCard('b', async () => bytes(16))
    expect(cardCacheSize()).toBe(2)
  })

  it('does not cache a failed render, so the next request retries', async () => {
    const render = vi
      .fn<() => Promise<Uint8Array>>()
      .mockRejectedValueOnce(new Error('rasteriser fell over'))
      .mockResolvedValueOnce(bytes(8))
    await expect(cachedCard('k', render)).rejects.toThrow('rasteriser fell over')
    expect(cardCacheSize()).toBe(0)
    await expect(cachedCard('k', render)).resolves.toMatchObject({ bytes: bytes(8) })
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('bounds the cache instead of growing without limit', async () => {
    for (let i = 0; i < 200; i++) await cachedCard(`k${i}`, async () => bytes(8))
    expect(cardCacheSize()).toBeLessThanOrEqual(48)
    // The newest key survived; the oldest was evicted.
    const render = vi.fn(async () => bytes(8))
    await cachedCard('k199', render)
    expect(render).not.toHaveBeenCalled()
  })

  it('gives different bodies different etags', async () => {
    const a = await cachedCard('a', async () => bytes(8))
    const b = await cachedCard('b', async () => bytes(16))
    expect(a.etag).not.toBe(b.etag)
  })
})

describe('cardCacheControl', () => {
  it('caches a fingerprinted URL immutably', () => {
    expect(cardCacheControl(true)).toContain('immutable')
    expect(cardCacheControl(true)).toContain('max-age=31536000')
  })

  it('caches an unversioned URL for long enough to absorb a burst, not forever', () => {
    const value = cardCacheControl(false)
    expect(value).not.toContain('immutable')
    expect(value).toContain('max-age=3600')
    expect(value).toContain('stale-while-revalidate')
  })
})

describe('notModified', () => {
  const etag = 'W/"og-x-1"'

  it('is false without an If-None-Match', () => {
    expect(notModified(new Request('https://x.test/'), etag)).toBe(false)
  })

  it('matches the exact tag, including one in a list', () => {
    const req = (v: string) => new Request('https://x.test/', { headers: { 'if-none-match': v } })
    expect(notModified(req(etag), etag)).toBe(true)
    expect(notModified(req(`W/"other", ${etag}`), etag)).toBe(true)
    expect(notModified(req('*'), etag)).toBe(true)
  })

  it('does not match a different card', () => {
    const req = new Request('https://x.test/', { headers: { 'if-none-match': 'W/"og-y-2"' } })
    expect(notModified(req, etag)).toBe(false)
  })
})
