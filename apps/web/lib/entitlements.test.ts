import { DEFAULT_ENTITLEMENT_OVERRIDES, type SessionUser } from '@palscans/core'
import { describe, expect, it } from 'vitest'
import { gateFor } from './entitlements'

const now = new Date('2026-09-02T12:00:00Z')
const soon = new Date('2026-09-03T12:00:00Z')
const past = new Date('2026-09-01T12:00:00Z')

const reader: SessionUser = { id: 1, role: 'user', entitlements: [] }
const premium: SessionUser = {
  id: 2,
  role: 'premium',
  entitlements: [{ feature: 'premium_content', expires_at: null }],
}
const admin: SessionUser = { id: 3, role: 'admin' }

const withFeatures = (f: Partial<Record<string, string>>, extra = {}) => ({
  ...DEFAULT_ENTITLEMENT_OVERRIDES,
  ...extra,
  features: { ...DEFAULT_ENTITLEMENT_OVERRIDES.features, ...f },
})

describe('gateFor — the request-scoped gate the app calls', () => {
  it('defaults to today’s premium behaviour', () => {
    const g = gateFor(DEFAULT_ENTITLEMENT_OVERRIDES, now)
    expect(g.mode('offline')).toBe('premium')
    expect(g.isFree('offline')).toBe(false)
    expect(g.can('offline', null)).toBe(false)
    expect(g.can('premium_content', premium)).toBe(true)
    expect(g.showsAds(reader)).toBe(true)
    expect(g.promotionActive).toBe(false)
  })

  it('makes a free feature true for signed-out readers and hides the ads', () => {
    const g = gateFor(withFeatures({ no_ads: 'free' }), now)
    expect(g.isFree('no_ads')).toBe(true)
    expect(g.can('no_ads', null)).toBe(true)
    expect(g.showsAds(null)).toBe(false)
    expect(g.showsAds(reader)).toBe(false)
  })

  it('a disabled feature is false for staff too', () => {
    const g = gateFor(withFeatures({ offline: 'disabled' }), now)
    expect(g.can('offline', admin)).toBe(false)
    expect(g.mode('offline')).toBe('disabled')
  })

  it('unlocks a premium chapter for everyone while premium_content is free', () => {
    const chapter = { state: 'published', is_premium: true, early_access_until: null }
    expect(gateFor(DEFAULT_ENTITLEMENT_OVERRIDES, now).canReadChapter(null, chapter)).toBe(false)
    expect(
      gateFor(withFeatures({ premium_content: 'free' }), now).canReadChapter(null, chapter),
    ).toBe(true)
  })

  it('the master switch runs out with its window', () => {
    const open = gateFor(withFeatures({}, { all_free: true, free_until: soon.toISOString() }), now)
    expect(open.promotionActive).toBe(true)
    expect(open.can('early_access', reader)).toBe(true)

    const closed = gateFor(
      withFeatures({}, { all_free: true, free_until: past.toISOString() }),
      now,
    )
    expect(closed.promotionActive).toBe(false)
    expect(closed.can('early_access', reader)).toBe(false)
  })

  it('takes an explicit clock per call', () => {
    const g = gateFor(withFeatures({}, { all_free: true, free_until: soon.toISOString() }), now)
    expect(g.can('no_ads', reader, new Date('2026-09-04T12:00:00Z'))).toBe(false)
  })
})
