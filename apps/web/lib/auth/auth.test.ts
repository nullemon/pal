import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseHibpRange } from './hibp'
import { createMemoryRateLimiter } from './rate-limit'
import { safeReturnPath, withReturn } from './return-to'
import { signValue, verifyValue } from './signed'

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
