import { type EntitlementRow, isStaff, type SessionUser } from './permissions.js'

/** Features an entitlement row can grant. Extend as products are added. */
export const FEATURES = ['early_access', 'premium_content', 'no_ads', 'offline'] as const
export type Feature = (typeof FEATURES)[number]

/** True when a row grants the feature at `now` (null expiry = permanent). */
export const rowActive = (row: EntitlementRow, now: Date = new Date()): boolean =>
  row.expires_at === null || row.expires_at.getTime() > now.getTime()

/** Pure check over a set of entitlement rows, no staff bypass. */
export const hasActiveEntitlement = (
  rows: readonly EntitlementRow[] | null | undefined,
  feature: Feature | string,
  now: Date = new Date(),
): boolean => !!rows?.some((r) => r.feature === feature && rowActive(r, now))

/**
 * docs/07-auth-and-monetization.md: entitlement answers "what may this person access".
 * Staff (admin, moderator) bypass once, here — never anywhere else.
 * The user's rows are expected on `user.entitlements`; a missing array means "no rows".
 */
export const entitlement = (
  user: SessionUser | null | undefined,
  feature: Feature | string,
  now: Date = new Date(),
): boolean => {
  if (!user) return false
  if (isStaff(user)) return true
  return hasActiveEntitlement(user.entitlements, feature, now)
}

/** The list of features currently active for a user (staff get all known features). */
export const activeFeatures = (
  user: SessionUser | null | undefined,
  now: Date = new Date(),
): Feature[] => {
  if (!user) return []
  if (isStaff(user)) return [...FEATURES]
  return FEATURES.filter((f) => hasActiveEntitlement(user.entitlements, f, now))
}
