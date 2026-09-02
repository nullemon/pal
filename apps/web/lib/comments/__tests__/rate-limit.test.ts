import { describe, expect, it } from 'vitest'
import { MemoryRateLimiter, RedisRateLimiter } from '../rate-limit'

describe('MemoryRateLimiter', () => {
  it('allows up to the limit per window and then rejects', async () => {
    let t = 1_000_000
    const rl = new MemoryRateLimiter(() => t)
    for (let i = 0; i < 3; i++) expect((await rl.hit('k', 3, 60)).ok).toBe(true)
    const fourth = await rl.hit('k', 3, 60)
    expect(fourth.ok).toBe(false)
    expect(fourth.retryAfterSec).toBeGreaterThan(0)
    t += 61_000
    expect((await rl.hit('k', 3, 60)).ok).toBe(true)
  })
})

describe('RedisRateLimiter', () => {
  it('falls back to memory when redis is unavailable', async () => {
    const rl = new RedisRateLimiter(Promise.resolve(null))
    expect((await rl.hit('x', 1, 60)).ok).toBe(true)
    expect((await rl.hit('x', 1, 60)).ok).toBe(false)
  })
  it('uses INCR/PTTL when redis answers', async () => {
    let count = 0
    const fake = {
      multi: () => ({
        incr: function () {
          count++
          return this
        },
        pttl: function () {
          return this
        },
        exec: async (): Promise<Array<[Error | null, unknown]>> => [
          [null, count],
          [null, -1],
        ],
      }),
      pexpire: async () => 1,
    }
    const rl = new RedisRateLimiter(Promise.resolve(fake))
    expect((await rl.hit('y', 2, 60)).ok).toBe(true)
    expect((await rl.hit('y', 2, 60)).ok).toBe(true)
    expect((await rl.hit('y', 2, 60)).ok).toBe(false)
  })
})
