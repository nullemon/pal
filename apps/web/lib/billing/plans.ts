import { type Db, plans } from '@palscans/db'
import { asc } from 'drizzle-orm'

/** A plan as every billing surface reads it. */
export interface BillingPlan {
  id: string
  name: string
  priceCents: number
  interval: string
  stripePriceId: string
  features: readonly string[]
  active: boolean
}

/**
 * What each seeded tier grants when `plans.features` has not been filled in yet (the column
 * arrived with migration 9008). The operator edits the column from Admin → Premium; this map
 * only keeps an un-migrated row from granting nothing at all.
 */
export const DEFAULT_PLAN_FEATURES: Record<string, readonly string[]> = {
  supporter: ['no_ads'],
  premium: ['no_ads', 'early_access', 'premium_content', 'offline'],
}

export const planFeatures = (plan: {
  id: string
  features?: readonly string[] | null
}): readonly string[] => {
  const rows = (plan.features ?? []).filter((f) => typeof f === 'string' && f.length > 0)
  return rows.length > 0 ? rows : (DEFAULT_PLAN_FEATURES[plan.id] ?? [])
}

/**
 * The seed ships `price_dev_*` placeholders so the plans render before Stripe exists. They are
 * not sellable: Checkout would fail with "no such price", so the button says so instead.
 */
export const PLACEHOLDER_PRICE_PREFIX = 'price_dev_'

export const isPlaceholderPrice = (stripePriceId: string): boolean =>
  !stripePriceId || stripePriceId.startsWith(PLACEHOLDER_PRICE_PREFIX)

/** A plan can be bought only with a real Stripe price behind it. */
export const isSellable = (plan: BillingPlan): boolean =>
  plan.active && !isPlaceholderPrice(plan.stripePriceId)

export const listPlans = async (db: Db): Promise<BillingPlan[]> => {
  const rows = await db.select().from(plans).orderBy(asc(plans.priceCents))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priceCents: r.priceCents,
    interval: r.interval,
    stripePriceId: r.stripePriceId,
    features: planFeatures(r),
    active: r.active,
  }))
}

/** `$5.00` — prices are stored in cents and always shown in the plan's currency (USD today). */
export const formatPrice = (cents: number, currency = 'usd'): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
