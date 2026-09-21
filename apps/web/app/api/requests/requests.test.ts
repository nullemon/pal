import { describe, expect, it } from 'vitest'
import { createRequestSchema } from '@/components/requests/schemas'
import {
  SUBMIT_PER_DAY,
  SUBMIT_PER_HOUR,
  submitLimit,
  VOTE_PER_HOUR,
  voteLimit,
} from '@/components/requests/server/guards'
import { type RequestActor, voterKeyFor } from '@/components/requests/server/identity'
import { boardHref } from '@/components/requests/shared'
import { createMemoryRateLimiter } from '@/lib/auth/rate-limit'
import { visitorKeyFor } from '@/lib/visitor'

/**
 * The defences on the request board's public write path, and the identity they are keyed to.
 *
 * `POST /api/requests` is the only endpoint on the site that accepts free text with no
 * account, so what stops abuse is worth asserting rather than assuming. The database half of
 * the same story — one vote per person as a primary key, one row per title as a unique index
 * — is in `packages/db/src/queries/requests.test.ts`, against a real Postgres.
 */

const actor = (over: Partial<RequestActor> = {}): RequestActor => ({
  userId: null,
  voterKey: null,
  source: 'visitor',
  limitKey: null,
  ...over,
})

describe('the anonymous voter key', () => {
  const secret = 'test-secret-value-that-is-long-enough'

  it('is stable for the same identity — no daily rotation, or a vote a day is free', () => {
    const monday = voterKeyFor('c:9f2a1b', secret)
    const tuesday = voterKeyFor('c:9f2a1b', secret)
    expect(Buffer.from(tuesday).toString('hex')).toBe(Buffer.from(monday).toString('hex'))
    expect(monday).toHaveLength(16)
  })

  it('separates accounts from visitor cookies, and both from one another', () => {
    const hex = (v: Uint8Array) => Buffer.from(v).toString('hex')
    const keys = [
      voterKeyFor('u:41', secret),
      voterKeyFor('c:41', secret),
      voterKeyFor('c:9f2a1b', secret),
    ].map(hex)
    expect(new Set(keys).size).toBe(3)
  })

  it('is keyed by the app secret, so the cookie is not recoverable from the table', () => {
    const a = voterKeyFor('c:9f2a1b', secret)
    const b = voterKeyFor('c:9f2a1b', 'a-different-secret-entirely-here')
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'))
  })

  it('is derived from the cookie under a scope, never from an address', () => {
    // The scope is what keeps one reader's votes from being joinable to their views.
    expect(Buffer.from(voterKeyFor('c:9f2a1b', secret)).toString('hex')).toBe(
      Buffer.from(visitorKeyFor('rq:v1', 'c:9f2a1b', secret)).toString('hex'),
    )
    expect(Buffer.from(visitorKeyFor('pv:v1', 'c:9f2a1b', secret)).toString('hex')).not.toBe(
      Buffer.from(visitorKeyFor('rq:v1', 'c:9f2a1b', secret)).toString('hex'),
    )
  })
})

describe('rate limits on the public write path', () => {
  it('allows three submissions an hour from one address and refuses the fourth', async () => {
    const who = actor({ limitKey: 'test-address-a' })
    for (let i = 0; i < SUBMIT_PER_HOUR; i++) expect((await submitLimit(who)).ok).toBe(true)
    const refused = await submitLimit(who)
    expect(refused.ok).toBe(false)
    expect(refused.retryAfterSec).toBeGreaterThan(0)
  })

  it('does not let a second address spend the first one budget', async () => {
    const first = actor({ limitKey: 'test-address-b' })
    for (let i = 0; i < SUBMIT_PER_HOUR; i++) await submitLimit(first)
    expect((await submitLimit(first)).ok).toBe(false)
    expect((await submitLimit(actor({ limitKey: 'test-address-c' }))).ok).toBe(true)
  })

  it('limits a signed-in reader by account as well as by address', async () => {
    // Same account, a new address each time: the account bucket still runs out.
    for (let i = 0; i < SUBMIT_PER_HOUR; i++)
      expect((await submitLimit(actor({ userId: 9001, limitKey: `roaming-${i}` }))).ok).toBe(true)
    expect((await submitLimit(actor({ userId: 9001, limitKey: 'roaming-last' }))).ok).toBe(false)
    // …and a different account on that same last address is unaffected.
    expect((await submitLimit(actor({ userId: 9002, limitKey: 'roaming-last' }))).ok).toBe(true)
  })

  it('caps the day as well as the hour, so patience is not a way round it', async () => {
    expect(SUBMIT_PER_DAY).toBeGreaterThan(SUBMIT_PER_HOUR)
    // A clock we drive: spend the hourly budget, wait out the window, repeat. The hourly cap
    // never fires again — the daily one does.
    let now = Date.UTC(2026, 0, 1)
    const limiter = createMemoryRateLimiter(() => now)
    const who = actor({ limitKey: 'patient-address' })
    let allowed = 0
    for (let hour = 0; hour < 8; hour++) {
      for (let i = 0; i < SUBMIT_PER_HOUR; i++) if ((await submitLimit(who, limiter)).ok) allowed++
      now += 3_600_000 + 1000
    }
    expect(allowed).toBe(SUBMIT_PER_DAY)
    expect((await submitLimit(who, limiter)).ok).toBe(false)
  })

  it('budgets votes far more generously than submissions', async () => {
    expect(VOTE_PER_HOUR).toBeGreaterThan(SUBMIT_PER_HOUR * 5)
    const who = actor({ limitKey: 'voter-address' })
    for (let i = 0; i < VOTE_PER_HOUR; i++) expect((await voteLimit(who)).ok).toBe(true)
    expect((await voteLimit(who)).ok).toBe(false)
  })

  it('does not pool unidentifiable clients into one shared bucket', async () => {
    // With no trusted proxy and no cookie there is no key. Counting them together would let
    // one client lock the form for everybody, so they are left to the other gates instead.
    const nobody = actor()
    for (let i = 0; i < SUBMIT_PER_HOUR * 3; i++) expect((await submitLimit(nobody)).ok).toBe(true)
  })
})

describe('the submission body', () => {
  const valid = { title: 'Solo Leveling' }

  it('accepts a bare title', () => {
    const parsed = createRequestSchema.parse(valid)
    expect(parsed.title).toBe('Solo Leveling')
    expect(parsed.altTitles).toEqual([])
    expect(parsed.link).toBeNull()
    expect(parsed.type).toBeNull()
  })

  it('refuses a filled honeypot', () => {
    expect(createRequestSchema.safeParse({ ...valid, website: 'https://spam' }).success).toBe(false)
  })

  it('refuses a title that is only whitespace, and one that is too long', () => {
    expect(createRequestSchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(createRequestSchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(false)
  })

  it('splits alternative titles and caps them at ten', () => {
    const parsed = createRequestSchema.parse({
      ...valid,
      altTitles: Array.from({ length: 20 }, (_, i) => `alias ${i}`).join('\n'),
    })
    expect(parsed.altTitles).toHaveLength(10)
    expect(parsed.altTitles[0]).toBe('alias 0')
  })

  it('accepts an empty link but refuses a non-http one', () => {
    expect(createRequestSchema.parse({ ...valid, link: '' }).link).toBeNull()
    expect(createRequestSchema.parse({ ...valid, link: 'https://mangaupdates.com/x' }).link).toBe(
      'https://mangaupdates.com/x',
    )
    expect(createRequestSchema.safeParse({ ...valid, link: 'javascript:alert(1)' }).success).toBe(
      false,
    )
    expect(createRequestSchema.safeParse({ ...valid, link: 'not a url' }).success).toBe(false)
  })

  it('refuses a type that is not one the catalogue has', () => {
    expect(createRequestSchema.parse({ ...valid, type: 'manhwa' }).type).toBe('manhwa')
    expect(createRequestSchema.parse({ ...valid, type: '' }).type).toBeNull()
    expect(createRequestSchema.safeParse({ ...valid, type: 'anime' }).success).toBe(false)
  })
})

describe('board links', () => {
  it('leaves the defaults out of the URL', () => {
    expect(boardHref('open', 'votes')).toBe('/requests')
    expect(boardHref('added', 'votes')).toBe('/requests?status=added')
    expect(boardHref('open', 'new', 3)).toBe('/requests?sort=new&page=3')
  })
})
