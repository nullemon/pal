import { bodyFromText, plainText } from '@palscans/core/comments'
import { describe, expect, it } from 'vitest'
import {
  accountGate,
  applyWordFilters,
  challengeRequired,
  isDuplicate,
  rateLimitsFor,
} from '../pipeline'
import { MemoryRateLimiter } from '../rate-limit'
import { DEFAULT_COMMENT_SETTINGS } from '../settings'

describe('challengeRequired (Turnstile, docs/14 §2 step 3)', () => {
  const aged = { createdAt: new Date('2026-01-01T00:00:00Z') }
  const fresh = { createdAt: new Date(now.getTime() - 3 * 86_400_000) }
  it('challenges accounts under 7 days old', () => {
    expect(challengeRequired(fresh, DEFAULT_COMMENT_SETTINGS, false, now)).toBe(true)
    expect(challengeRequired(aged, DEFAULT_COMMENT_SETTINGS, false, now)).toBe(false)
  })
  it('challenges after a rate-limit hit and everyone under lockdown', () => {
    expect(challengeRequired(aged, DEFAULT_COMMENT_SETTINGS, true, now)).toBe(true)
    expect(
      challengeRequired(aged, { ...DEFAULT_COMMENT_SETTINGS, lockdown: true }, false, now),
    ).toBe(true)
  })
  it('the memory limiter exposes a live count for the limited flag', async () => {
    let t = 0
    const limiter = new MemoryRateLimiter(() => t)
    expect(await limiter.count('flag')).toBe(0)
    await limiter.hit('flag', 1, 3600)
    expect(await limiter.count('flag')).toBe(1)
    t += 3_600_001
    expect(await limiter.count('flag')).toBe(0)
  })
})

const now = new Date('2026-09-02T12:00:00Z')
const user = (over: Partial<Parameters<typeof accountGate>[0]> = {}) => ({
  emailVerifiedAt: now,
  commentBannedUntil: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  role: 'user' as const,
  ...over,
})

describe('accountGate', () => {
  it('lets a verified, aged account through', () => {
    expect(accountGate(user(), DEFAULT_COMMENT_SETTINGS, now)).toBeNull()
  })
  it('requires a verified email', () => {
    expect(accountGate(user({ emailVerifiedAt: null }), DEFAULT_COMMENT_SETTINGS, now)).toBe(
      'unverified',
    )
  })
  it('blocks comment-banned users', () => {
    expect(
      accountGate(
        user({ commentBannedUntil: new Date(now.getTime() + 1000) }),
        DEFAULT_COMMENT_SETTINGS,
        now,
      ),
    ).toBe('banned')
    expect(
      accountGate(
        user({ commentBannedUntil: new Date(now.getTime() - 1000) }),
        DEFAULT_COMMENT_SETTINGS,
        now,
      ),
    ).toBeNull()
  })
  it('enforces the minimum account age, except for staff', () => {
    const fresh = new Date(now.getTime() - 2 * 60_000)
    expect(accountGate(user({ createdAt: fresh }), DEFAULT_COMMENT_SETTINGS, now)).toBe('too_new')
    expect(
      accountGate(user({ createdAt: fresh, role: 'moderator' }), DEFAULT_COMMENT_SETTINGS, now),
    ).toBeNull()
  })
  it('honours the global kill switch', () => {
    expect(accountGate(user(), { ...DEFAULT_COMMENT_SETTINGS, enabled: false }, now)).toBe(
      'disabled',
    )
  })
})

describe('applyWordFilters', () => {
  const body = bodyFromText('Buy cheap RAWS here, darn it')
  it('blocks on the block list', () => {
    expect(
      applyWordFilters(body, [
        { pattern: 'raws', isRegex: false, action: 'block', replacement: null },
      ]).action,
    ).toBe('block')
  })
  it('holds on the hold list', () => {
    expect(
      applyWordFilters(body, [
        { pattern: 'cheap', isRegex: false, action: 'hold', replacement: null },
      ]).action,
    ).toBe('hold')
  })
  it('masks replace-list words and keeps the structure', () => {
    const out = applyWordFilters(body, [
      { pattern: 'darn', isRegex: false, action: 'replace', replacement: '****' },
    ])
    expect(out.action).toBe('none')
    expect(plainText(out.body)).toBe('Buy cheap RAWS here, **** it')
  })
  it('supports regex patterns and ignores invalid ones', () => {
    expect(
      applyWordFilters(body, [
        { pattern: 'r[a4]ws', isRegex: true, action: 'block', replacement: null },
      ]).action,
    ).toBe('block')
    expect(
      applyWordFilters(body, [{ pattern: '(', isRegex: true, action: 'block', replacement: null }])
        .action,
    ).toBe('none')
  })
  it('matches whole words only for literal patterns', () => {
    expect(
      applyWordFilters(bodyFromText('classic'), [
        { pattern: 'ass', isRegex: false, action: 'block', replacement: null },
      ]).action,
    ).toBe('none')
  })
})

describe('isDuplicate', () => {
  it('ignores whitespace and case', () => {
    expect(isDuplicate('Great  chapter!', ['great chapter!'], [])).toBe(true)
    expect(isDuplicate('Great chapter!', [], ['GREAT CHAPTER!'])).toBe(true)
    expect(isDuplicate('Great chapter!', ['meh'], [])).toBe(false)
  })
})

describe('rateLimitsFor', () => {
  it('is stricter for accounts younger than 7 days', () => {
    expect(
      rateLimitsFor(
        { createdAt: new Date(now.getTime() - 86_400_000) },
        DEFAULT_COMMENT_SETTINGS,
        now,
      ),
    ).toEqual({ perMinute: 2, perHour: 20 })
    expect(
      rateLimitsFor({ createdAt: new Date('2026-01-01') }, DEFAULT_COMMENT_SETTINGS, now),
    ).toEqual({ perMinute: 5, perHour: 60 })
  })
})
