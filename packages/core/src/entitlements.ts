import { z } from 'zod'
import { type EntitlementRow, isStaff, type SessionUser } from './permissions.js'

/**
 * Features an entitlement row can grant, and the features the operator controls from
 * `Admin → Business → Premium` (docs/17 §B). Extend as products are added — every new
 * name needs a mode in `EntitlementOverrides.features`, so keep the two in step.
 */
export const FEATURES = [
  'early_access',
  'premium_content',
  'offline',
  'no_ads',
  'priority_comments',
  'see_reactors',
  'custom_gifs',
  'animated_avatar',
  'profile_banner',
] as const
export type Feature = (typeof FEATURES)[number]

export const isFeature = (value: unknown): value is Feature =>
  typeof value === 'string' && (FEATURES as readonly string[]).includes(value)

/**
 * The operator's three-way control per feature (docs/17 §B):
 * - `premium`  — today's behaviour: staff bypass, then the user's entitlement rows.
 * - `free`     — true for everyone, signed-out readers included where the feature can
 *                mean anything to them (`ANONYMOUS_FEATURES`).
 * - `disabled` — false for everyone, staff included. The product is switched off.
 */
export const FEATURE_MODES = ['premium', 'free', 'disabled'] as const
export type FeatureMode = (typeof FEATURE_MODES)[number]

/**
 * Features that can be true for a signed-out reader. Reading early, reading premium
 * chapters, seeing no ads, downloading and seeing who reacted all work without an account;
 * commenting perks, avatars and banners cannot exist without one, so `free` still resolves
 * to false for anonymous visitors there.
 */
export const ANONYMOUS_FEATURES: readonly Feature[] = [
  'early_access',
  'premium_content',
  'no_ads',
  'offline',
  'see_reactors',
]

/**
 * Perks a Premium subscription carries without a row of their own: the tier grants
 * `premium_content` and these ride along with it (this is what the comment perks checked
 * against `premium_content` before docs/17 §B split them into named features).
 */
export const PREMIUM_PERKS: readonly Feature[] = [
  'priority_comments',
  'see_reactors',
  'custom_gifs',
  'animated_avatar',
  'profile_banner',
]

/** `settings.entitlements` — the operator's overrides. Pure data, no DB types. */
export interface EntitlementOverrides {
  /** Master switch: every feature not explicitly `disabled` reads as `free`. */
  all_free: boolean
  /** ISO timestamp the master switch stops at, so a promotion ends by itself. */
  free_until: string | null
  features: Record<Feature, FeatureMode>
}

const modeSchema = z.enum(FEATURE_MODES)

/** Strict shape for the admin PUT — every feature must carry a mode. */
export const entitlementOverridesSchema = z.object({
  all_free: z.boolean(),
  free_until: z.string().datetime({ offset: true }).nullable(),
  features: z.object(
    Object.fromEntries(FEATURES.map((f) => [f, modeSchema])) as Record<Feature, typeof modeSchema>,
  ),
})

export const DEFAULT_ENTITLEMENT_OVERRIDES: EntitlementOverrides = {
  all_free: false,
  free_until: null,
  features: Object.fromEntries(FEATURES.map((f) => [f, 'premium'])) as Record<Feature, FeatureMode>,
}

const storedSchema = z.object({
  all_free: z.boolean().optional(),
  free_until: z.string().nullable().optional(),
  features: z.record(z.string(), z.string()).optional(),
})

/**
 * Read `settings.entitlements` leniently: an unknown key, a missing feature or a value
 * written by an older build falls back to the default instead of throwing, so a bad row can
 * never take the site down. Unknown feature names are dropped.
 */
export const parseEntitlementOverrides = (raw: unknown): EntitlementOverrides => {
  const parsed = storedSchema.safeParse(raw)
  if (!parsed.success) return DEFAULT_ENTITLEMENT_OVERRIDES
  const stored = parsed.data.features ?? {}
  const features = { ...DEFAULT_ENTITLEMENT_OVERRIDES.features }
  for (const f of FEATURES) {
    const value = stored[f]
    if (value && (FEATURE_MODES as readonly string[]).includes(value))
      features[f] = value as FeatureMode
  }
  const until = parsed.data.free_until ?? null
  return {
    all_free: parsed.data.all_free ?? false,
    free_until: until && Number.isFinite(Date.parse(until)) ? until : null,
    features,
  }
}

/** True while the master switch is on and its window (if any) has not closed. */
export const promotionActive = (
  overrides: EntitlementOverrides | null | undefined,
  now: Date = new Date(),
): boolean => {
  if (!overrides?.all_free) return false
  if (overrides.free_until === null) return true
  const ends = Date.parse(overrides.free_until)
  return Number.isFinite(ends) && ends > now.getTime()
}

/** Milliseconds left on the promotion window, or null when there is no live window. */
export const promotionEndsIn = (
  overrides: EntitlementOverrides | null | undefined,
  now: Date = new Date(),
): number | null => {
  if (!overrides?.all_free || overrides.free_until === null) return null
  const ends = Date.parse(overrides.free_until)
  if (!Number.isFinite(ends)) return null
  return Math.max(0, ends - now.getTime())
}

/**
 * The mode actually in force for a feature: its own setting, with the master switch
 * promoting `premium` to `free` while its window is open. `disabled` always wins — the
 * master switch never turns a switched-off product back on.
 */
export const featureMode = (
  overrides: EntitlementOverrides | null | undefined,
  feature: Feature | string,
  now: Date = new Date(),
): FeatureMode => {
  const declared = overrides?.features?.[feature as Feature]
  const mode: FeatureMode =
    declared && (FEATURE_MODES as readonly string[]).includes(declared) ? declared : 'premium'
  if (mode !== 'premium') return mode
  return promotionActive(overrides, now) ? 'free' : 'premium'
}

/** What `entitlement()` needs besides the user: the operator's overrides and the clock. */
export interface EntitlementContext {
  overrides?: EntitlementOverrides | null
  now?: Date
}

/** Third argument of the gates: a context, or just a clock for callers with no overrides. */
export type EntitlementArg = EntitlementContext | Date | undefined

export const entitlementContext = (
  arg?: EntitlementArg,
): { overrides: EntitlementOverrides | null; now: Date } => {
  if (arg instanceof Date) return { overrides: null, now: arg }
  return { overrides: arg?.overrides ?? null, now: arg?.now ?? new Date() }
}

/** True when a row grants the feature at `now` (null expiry = permanent). */
export const rowActive = (row: EntitlementRow, now: Date = new Date()): boolean =>
  row.expires_at === null || row.expires_at.getTime() > now.getTime()

/** Pure check over a set of entitlement rows, no staff bypass and no overrides. */
export const hasActiveEntitlement = (
  rows: readonly EntitlementRow[] | null | undefined,
  feature: Feature | string,
  now: Date = new Date(),
): boolean => !!rows?.some((r) => r.feature === feature && rowActive(r, now))

/**
 * docs/07-auth-and-monetization.md: entitlement answers "what may this person access".
 * docs/17 §B: the operator's override is consulted *first*, so any premium feature can be
 * made free — or switched off — without a code change.
 *
 * - `disabled` → false for everyone, staff included.
 * - `free`     → true for everyone; signed-out readers too when the feature can apply to
 *                them (`ANONYMOUS_FEATURES`).
 * - `premium`  → staff bypass once, here — never anywhere else — then the user's rows,
 *                with `PREMIUM_PERKS` riding along on an active `premium_content` row.
 *
 * Pure: the overrides come in on `arg`, loaded once per request by the caller.
 */
export const entitlement = (
  user: SessionUser | null | undefined,
  feature: Feature | string,
  arg?: EntitlementArg,
): boolean => {
  const { overrides, now } = entitlementContext(arg)
  switch (featureMode(overrides, feature, now)) {
    case 'disabled':
      return false
    case 'free':
      return !!user || (ANONYMOUS_FEATURES as readonly string[]).includes(feature)
    default:
      break
  }
  if (!user) return false
  if (isStaff(user)) return true
  if (hasActiveEntitlement(user.entitlements, feature, now)) return true
  return (
    (PREMIUM_PERKS as readonly string[]).includes(feature) &&
    hasActiveEntitlement(user.entitlements, 'premium_content', now)
  )
}

/**
 * The features currently active for a user, overrides included (staff get everything the
 * operator has not disabled). Anonymous callers get the features that are free for them.
 */
export const activeFeatures = (
  user: SessionUser | null | undefined,
  arg?: EntitlementArg,
): Feature[] => FEATURES.filter((f) => entitlement(user, f, arg))
