import { describe, expect, it } from 'vitest'
import { canReadChapter, showsAds } from '../access.js'
import {
  ANONYMOUS_FEATURES,
  DEFAULT_ENTITLEMENT_OVERRIDES,
  type EntitlementOverrides,
  entitlement,
  entitlementOverridesSchema,
  FEATURES,
  type FeatureMode,
  featureMode,
  parseEntitlementOverrides,
  promotionActive,
  promotionEndsIn,
} from '../entitlements.js'
import type { SessionUser } from '../permissions.js'

const now = new Date('2026-09-02T12:00:00Z')
const later = new Date('2026-09-09T12:00:00Z')
const earlier = new Date('2026-08-26T12:00:00Z')

const anon = null
const reader: SessionUser = { id: 1, role: 'user', entitlements: [] }
const premium: SessionUser = {
  id: 2,
  role: 'premium',
  entitlements: [{ feature: 'premium_content', expires_at: null }],
}
const staff: SessionUser = { id: 3, role: 'admin' }

const overrides = (
  features: Partial<Record<(typeof FEATURES)[number], FeatureMode>>,
  extra: Partial<EntitlementOverrides> = {},
): EntitlementOverrides => ({
  ...DEFAULT_ENTITLEMENT_OVERRIDES,
  ...extra,
  features: { ...DEFAULT_ENTITLEMENT_OVERRIDES.features, ...features },
})

describe('override matrix', () => {
  const audience = { anon, reader, premium, staff }

  it('premium keeps today’s behaviour for every audience', () => {
    const o = overrides({ premium_content: 'premium' })
    const ctx = { overrides: o, now }
    expect(entitlement(audience.anon, 'premium_content', ctx)).toBe(false)
    expect(entitlement(audience.reader, 'premium_content', ctx)).toBe(false)
    expect(entitlement(audience.premium, 'premium_content', ctx)).toBe(true)
    expect(entitlement(audience.staff, 'premium_content', ctx)).toBe(true)
  })

  it('free is true for everyone, signed-out readers included', () => {
    const ctx = { overrides: overrides({ premium_content: 'free' }), now }
    expect(entitlement(audience.anon, 'premium_content', ctx)).toBe(true)
    expect(entitlement(audience.reader, 'premium_content', ctx)).toBe(true)
    expect(entitlement(audience.premium, 'premium_content', ctx)).toBe(true)
    expect(entitlement(audience.staff, 'premium_content', ctx)).toBe(true)
  })

  it('free stays false for signed-out readers when the feature needs an account', () => {
    const ctx = { overrides: overrides({ custom_gifs: 'free' }), now }
    expect(entitlement(audience.anon, 'custom_gifs', ctx)).toBe(false)
    expect(entitlement(audience.reader, 'custom_gifs', ctx)).toBe(true)
    for (const f of ANONYMOUS_FEATURES)
      expect(entitlement(null, f, { overrides: overrides({ [f]: 'free' }), now })).toBe(true)
  })

  it('disabled is false for everyone including staff', () => {
    const ctx = { overrides: overrides({ premium_content: 'disabled' }), now }
    expect(entitlement(audience.anon, 'premium_content', ctx)).toBe(false)
    expect(entitlement(audience.reader, 'premium_content', ctx)).toBe(false)
    expect(entitlement(audience.premium, 'premium_content', ctx)).toBe(false)
    expect(entitlement(audience.staff, 'premium_content', ctx)).toBe(false)
  })

  it('no overrides at all behaves exactly as before', () => {
    expect(entitlement(reader, 'no_ads', now)).toBe(false)
    expect(entitlement(premium, 'premium_content', { now })).toBe(true)
    expect(entitlement(staff, 'offline', { overrides: null, now })).toBe(true)
  })
})

describe('master switch and promotion window', () => {
  it('all_free makes every premium feature free', () => {
    const ctx = { overrides: overrides({}, { all_free: true }), now }
    for (const f of FEATURES) expect(entitlement(reader, f, ctx)).toBe(true)
    expect(entitlement(anon, 'no_ads', ctx)).toBe(true)
    expect(entitlement(anon, 'custom_gifs', ctx)).toBe(false)
  })

  it('all_free never revives a disabled feature', () => {
    const ctx = { overrides: overrides({ offline: 'disabled' }, { all_free: true }), now }
    expect(entitlement(staff, 'offline', ctx)).toBe(false)
    expect(entitlement(reader, 'no_ads', ctx)).toBe(true)
  })

  it('the window ends the promotion by itself', () => {
    const open = overrides({}, { all_free: true, free_until: later.toISOString() })
    expect(promotionActive(open, now)).toBe(true)
    expect(entitlement(reader, 'early_access', { overrides: open, now })).toBe(true)
    expect(promotionEndsIn(open, now)).toBe(later.getTime() - now.getTime())

    const closed = overrides({}, { all_free: true, free_until: earlier.toISOString() })
    expect(promotionActive(closed, now)).toBe(false)
    expect(entitlement(reader, 'early_access', { overrides: closed, now })).toBe(false)
    expect(entitlement(premium, 'premium_content', { overrides: closed, now })).toBe(true)
    expect(promotionEndsIn(closed, now)).toBe(0)
  })

  it('a per-feature free is permanent — the window only scopes the master switch', () => {
    const o = overrides({ no_ads: 'free' }, { all_free: true, free_until: earlier.toISOString() })
    expect(featureMode(o, 'no_ads', now)).toBe('free')
    expect(featureMode(o, 'early_access', now)).toBe('premium')
    expect(promotionEndsIn(overrides({}, { all_free: false }), now)).toBe(null)
  })

  it('an unparsable window fails closed', () => {
    const o = { ...DEFAULT_ENTITLEMENT_OVERRIDES, all_free: true, free_until: 'soon' }
    expect(promotionActive(o, now)).toBe(false)
    expect(promotionEndsIn(o, now)).toBe(null)
  })
})

describe('premium perks ride on premium_content', () => {
  it('grants the comment and profile perks without their own row', () => {
    expect(entitlement(premium, 'see_reactors', { now })).toBe(true)
    expect(entitlement(premium, 'custom_gifs', { now })).toBe(true)
    expect(entitlement(premium, 'offline', { now })).toBe(false)
    expect(entitlement(reader, 'see_reactors', { now })).toBe(false)
  })
  it('an expired premium_content row takes the perks with it', () => {
    const lapsed: SessionUser = {
      id: 4,
      role: 'premium',
      entitlements: [{ feature: 'premium_content', expires_at: earlier }],
    }
    expect(entitlement(lapsed, 'see_reactors', { now })).toBe(false)
  })
})

describe('gates read the overrides', () => {
  const prem = { state: 'published', is_premium: true, early_access_until: null }
  const early = { state: 'published', is_premium: false, early_access_until: later }
  const draft = { state: 'draft', is_premium: false, early_access_until: null }

  it('a free premium_content unlocks locked chapters for signed-out readers', () => {
    const ctx = { overrides: overrides({ premium_content: 'free' }), now }
    expect(canReadChapter(anon, prem, ctx)).toBe(true)
    expect(canReadChapter(anon, early, ctx)).toBe(false)
  })
  it('a free early_access opens the window for everyone', () => {
    const ctx = { overrides: overrides({ early_access: 'free' }), now }
    expect(canReadChapter(anon, early, ctx)).toBe(true)
  })
  it('unpublished chapters stay behind chapter.read whatever the overrides say', () => {
    const ctx = { overrides: overrides({ premium_content: 'free', early_access: 'free' }), now }
    expect(canReadChapter(anon, draft, ctx)).toBe(false)
    expect(canReadChapter(reader, draft, ctx)).toBe(false)
  })
  it('a free no_ads hides ads for everyone', () => {
    expect(showsAds(anon, { overrides: overrides({ no_ads: 'free' }), now })).toBe(false)
    expect(showsAds(anon, { overrides: overrides({ no_ads: 'premium' }), now })).toBe(true)
    expect(showsAds(staff, { overrides: overrides({ no_ads: 'disabled' }), now })).toBe(true)
  })
})

describe('parsing settings.entitlements', () => {
  it('falls back to premium for anything missing or unknown', () => {
    expect(parseEntitlementOverrides(null)).toEqual(DEFAULT_ENTITLEMENT_OVERRIDES)
    expect(parseEntitlementOverrides('nonsense')).toEqual(DEFAULT_ENTITLEMENT_OVERRIDES)
    const parsed = parseEntitlementOverrides({
      all_free: true,
      free_until: later.toISOString(),
      features: { no_ads: 'free', offline: 'nope', ghost_feature: 'free' },
    })
    expect(parsed.all_free).toBe(true)
    expect(parsed.features.no_ads).toBe('free')
    expect(parsed.features.offline).toBe('premium')
    expect(Object.keys(parsed.features)).toHaveLength(FEATURES.length)
  })
  it('drops a window it cannot parse', () => {
    expect(parseEntitlementOverrides({ all_free: true, free_until: 'whenever' }).free_until).toBe(
      null,
    )
  })
  it('the admin schema demands a mode for every feature', () => {
    expect(entitlementOverridesSchema.safeParse(DEFAULT_ENTITLEMENT_OVERRIDES).success).toBe(true)
    expect(
      entitlementOverridesSchema.safeParse({ all_free: false, free_until: null, features: {} })
        .success,
    ).toBe(false)
  })
})
