import { describe, expect, it } from 'vitest'
import { createMemoryRateLimiter } from '@/lib/auth/rate-limit'
import { SEARCH_PER_MINUTE, type SearchActor, searchLimit } from './rate-limit'

/**
 * The budget on `/api/search`. The endpoint is anonymous, cacheable in name only (the cache
 * key is the caller's own `q`) and backed by a query that scans `series_titles`, so what
 * stops a loop is worth asserting rather than assuming. The limiter itself is covered in
 * `lib/auth`; this is about the buckets the endpoint counts in.
 */

const actor = (over: Partial<SearchActor> = {}): SearchActor => ({
  userId: null,
  limitKey: null,
  ...over,
})

/** A clock the test drives, so a one-minute window does not take a minute. */
const clock = () => {
  let t = 1_800_000_000_000
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('searchLimit', () => {
  it('allows the budget and refuses the request after it', async () => {
    const time = clock()
    const limiter = createMemoryRateLimiter(time.now)
    const anon = actor({ limitKey: 'addr-a' })
    for (let i = 0; i < SEARCH_PER_MINUTE; i++) {
      expect((await searchLimit(anon, limiter)).ok).toBe(true)
    }
    const refused = await searchLimit(anon, limiter)
    expect(refused.ok).toBe(false)
    expect(refused.retryAfterSec).toBeGreaterThan(0)
    expect(refused.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('starts the budget again in the next window', async () => {
    const time = clock()
    const limiter = createMemoryRateLimiter(time.now)
    const anon = actor({ limitKey: 'addr-b' })
    for (let i = 0; i <= SEARCH_PER_MINUTE; i++) await searchLimit(anon, limiter)
    expect((await searchLimit(anon, limiter)).ok).toBe(false)
    time.advance(61_000)
    expect((await searchLimit(anon, limiter)).ok).toBe(true)
  })

  it('budgets one address independently of another', async () => {
    const time = clock()
    const limiter = createMemoryRateLimiter(time.now)
    for (let i = 0; i <= SEARCH_PER_MINUTE; i++)
      await searchLimit(actor({ limitKey: 'noisy' }), limiter)
    expect((await searchLimit(actor({ limitKey: 'noisy' }), limiter)).ok).toBe(false)
    expect((await searchLimit(actor({ limitKey: 'quiet' }), limiter)).ok).toBe(true)
  })

  it('counts a signed-in reader per account as well as per address', async () => {
    const time = clock()
    const limiter = createMemoryRateLimiter(time.now)
    // Spend the account's budget from one address…
    for (let i = 0; i <= SEARCH_PER_MINUTE; i++)
      await searchLimit(actor({ userId: 7, limitKey: 'home' }), limiter)
    // …and moving to another address does not hand it a fresh one.
    expect((await searchLimit(actor({ userId: 7, limitKey: 'cafe' }), limiter)).ok).toBe(false)
    // Nor does signing out, from the address that was spending.
    expect((await searchLimit(actor({ limitKey: 'home' }), limiter)).ok).toBe(false)
    // A different reader on a fresh address is unaffected by either.
    expect((await searchLimit(actor({ userId: 8, limitKey: 'other' }), limiter)).ok).toBe(true)
  })

  it('allows the request when nothing identifies the caller', async () => {
    const time = clock()
    const limiter = createMemoryRateLimiter(time.now)
    // TRUSTED_PROXY=none and no session: there is no bucket to count in, and pooling every
    // such caller into one would let a single client switch search off for the site.
    for (let i = 0; i < SEARCH_PER_MINUTE * 3; i++) {
      expect((await searchLimit(actor(), limiter)).ok).toBe(true)
    }
  })
})
