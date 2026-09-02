import {
  type ChapterAccessInput,
  canReadChapter,
  DEFAULT_ENTITLEMENT_OVERRIDES,
  type EntitlementOverrides,
  entitlement,
  type Feature,
  type FeatureMode,
  featureMode,
  parseEntitlementOverrides,
  promotionActive,
  type SessionUser,
  showsAds,
} from '@palscans/core'
import { getDb, getSetting } from '@palscans/db'
import { unstable_cache } from 'next/cache'
import { cache } from 'react'

/**
 * docs/17 §B — the operator's entitlement overrides (`settings.entitlements`) read once and
 * handed to the pure gates in `@palscans/core`. Every premium gate in the app goes through
 * `(await entitlementGate()).can(feature, user)` so making a feature free for everyone is a
 * settings change, never a code change.
 *
 * The settings read is cached for 60s and tagged `settings`, so the admin save's
 * `purgeSettings()` (`revalidateTag('settings')`) takes effect immediately; `cache()` on top
 * memoises it per request.
 */
export const ENTITLEMENTS_SETTING_KEY = 'entitlements'

const loadOverrides = unstable_cache(
  async (): Promise<EntitlementOverrides> => {
    try {
      const raw = await getSetting<unknown>(await getDb(), ENTITLEMENTS_SETTING_KEY, null)
      return parseEntitlementOverrides(raw)
    } catch {
      // A database blip must never hand out (or withhold) access by accident: fall back to
      // the shipped defaults, which are "premium behaves as before".
      return DEFAULT_ENTITLEMENT_OVERRIDES
    }
  },
  ['settings', ENTITLEMENTS_SETTING_KEY],
  { revalidate: 60, tags: ['settings'] },
)

/** The overrides for this request. Prefer `entitlementGate()` unless you only need the data. */
export const entitlementOverrides = cache(async (): Promise<EntitlementOverrides> => {
  try {
    return await loadOverrides()
  } catch {
    // No request scope (unit tests, the worker) or an unreachable cache: ship the defaults,
    // which are exactly today's premium behaviour.
    return DEFAULT_ENTITLEMENT_OVERRIDES
  }
})

export interface EntitlementGate {
  overrides: EntitlementOverrides
  /** The mode actually in force (master switch and window applied). */
  mode: (feature: Feature | string) => FeatureMode
  /** True when the feature is free for everyone right now. */
  isFree: (feature: Feature | string) => boolean
  /** The one gate the app calls: `can('offline', user)`. */
  can: (feature: Feature | string, user: SessionUser | null | undefined, now?: Date) => boolean
  showsAds: (user: SessionUser | null | undefined, now?: Date) => boolean
  canReadChapter: (
    user: SessionUser | null | undefined,
    chapter: ChapterAccessInput,
    now?: Date,
  ) => boolean
  promotionActive: boolean
}

/** Build a gate over already-loaded overrides (route handlers that read them themselves). */
export const gateFor = (
  overrides: EntitlementOverrides,
  at: Date = new Date(),
): EntitlementGate => ({
  overrides,
  mode: (feature) => featureMode(overrides, feature, at),
  isFree: (feature) => featureMode(overrides, feature, at) === 'free',
  can: (feature, user, now) => entitlement(user, feature, { overrides, now: now ?? at }),
  showsAds: (user, now) => showsAds(user, { overrides, now: now ?? at }),
  canReadChapter: (user, chapter, now) =>
    canReadChapter(user, chapter, { overrides, now: now ?? at }),
  promotionActive: promotionActive(overrides, at),
})

/** Memoised per request: the gate every server component and route handler awaits. */
export const entitlementGate = cache(
  async (): Promise<EntitlementGate> => gateFor(await entitlementOverrides()),
)
