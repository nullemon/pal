import { describe, expect, it } from 'vitest'
import { canReadChapter, chapterLock, showsAds } from '../access.js'
import { activeFeatures, entitlement, FEATURES, hasActiveEntitlement } from '../entitlements.js'
import type { SessionUser } from '../permissions.js'

const now = new Date('2026-09-02T12:00:00Z')
const later = new Date('2026-09-03T12:00:00Z')
const earlier = new Date('2026-09-01T12:00:00Z')

const reader: SessionUser = { id: 1, role: 'user', entitlements: [] }
const premium: SessionUser = {
  id: 2,
  role: 'premium',
  entitlements: [
    { feature: 'early_access', expires_at: later },
    { feature: 'premium_content', expires_at: null },
    { feature: 'no_ads', expires_at: later },
  ],
}
const lapsed: SessionUser = {
  id: 3,
  role: 'premium',
  entitlements: [{ feature: 'early_access', expires_at: earlier }],
}
const mod: SessionUser = { id: 4, role: 'moderator' }
const uploader: SessionUser = { id: 5, role: 'uploader' }

describe('entitlement', () => {
  it('reads rows with expiry', () => {
    expect(entitlement(null, 'no_ads', now)).toBe(false)
    expect(entitlement(reader, 'no_ads', now)).toBe(false)
    expect(entitlement(premium, 'early_access', now)).toBe(true)
    expect(entitlement(premium, 'premium_content', now)).toBe(true)
    expect(entitlement(lapsed, 'early_access', now)).toBe(false)
    expect(hasActiveEntitlement(premium.entitlements, 'no_ads', later)).toBe(false)
  })
  it('staff bypass once', () => {
    expect(entitlement(mod, 'early_access', now)).toBe(true)
    expect(entitlement({ id: 9, role: 'admin' }, 'offline', now)).toBe(true)
    expect(entitlement(uploader, 'early_access', now)).toBe(false)
    expect(activeFeatures(mod, now)).toHaveLength(FEATURES.length)
    // premium_content carries the PREMIUM_PERKS with it; `offline` needs its own row
    expect(activeFeatures(premium, now)).toEqual([
      'early_access',
      'premium_content',
      'no_ads',
      'priority_comments',
      'see_reactors',
      'custom_gifs',
      'animated_avatar',
      'profile_banner',
    ])
  })
})

describe('canReadChapter', () => {
  const free = { state: 'published', is_premium: false, early_access_until: null }
  const early = { state: 'published', is_premium: false, early_access_until: later }
  const earlyOver = { state: 'published', is_premium: true, early_access_until: earlier }
  const prem = { state: 'published', is_premium: true, early_access_until: null }
  const draft = { state: 'draft', is_premium: false, early_access_until: null }

  it('free chapters are readable by anyone', () => {
    expect(canReadChapter(null, free, now)).toBe(true)
    expect(chapterLock(free, now)).toBe('none')
  })
  it('early access requires the entitlement until the window closes', () => {
    expect(canReadChapter(null, early, now)).toBe(false)
    expect(canReadChapter(reader, early, now)).toBe(false)
    expect(canReadChapter(premium, early, now)).toBe(true)
    expect(canReadChapter(lapsed, early, now)).toBe(false)
    expect(canReadChapter(mod, early, now)).toBe(true)
    expect(chapterLock(early, now)).toBe('early_access')
    // window closed, not premium → free
    expect(canReadChapter(null, { ...early, early_access_until: earlier }, now)).toBe(true)
  })
  it('premium chapters require premium_content', () => {
    expect(canReadChapter(reader, prem, now)).toBe(false)
    expect(canReadChapter(premium, prem, now)).toBe(true)
    expect(canReadChapter(reader, earlyOver, now)).toBe(false)
    expect(chapterLock(prem, now)).toBe('premium')
  })
  it('unpublished chapters need chapter.read', () => {
    expect(canReadChapter(null, draft, now)).toBe(false)
    expect(canReadChapter(premium, draft, now)).toBe(false)
    expect(canReadChapter(uploader, draft, now)).toBe(true)
    expect(canReadChapter(mod, draft, now)).toBe(true)
    expect(chapterLock(draft, now)).toBe('unpublished')
  })
  it('ads follow no_ads', () => {
    expect(showsAds(null, now)).toBe(true)
    expect(showsAds(premium, now)).toBe(false)
    expect(showsAds(mod, now)).toBe(false)
  })
})
