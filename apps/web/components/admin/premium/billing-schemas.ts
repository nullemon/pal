import { z } from 'zod'
import { billingSettingsSchema } from '@/lib/billing/settings'

/**
 * The shapes the Premium screen's billing half sends (agent A). Client-safe: no database and
 * no server-only import, so the panels and the route handler validate the same schema.
 */

export const billingSettingsInput = billingSettingsSchema

export type BillingSettingsInput = z.infer<typeof billingSettingsInput>

/** A feature name is a bare token — it lines up with `entitlements.feature`. */
const featureName = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and underscores')

export const planInput = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  priceCents: z.number().int().min(0).max(1_000_000),
  interval: z.enum(['month', 'year']),
  stripePriceId: z.string().trim().min(1).max(120),
  features: z.array(featureName).max(20),
  active: z.boolean(),
})

export type PlanInput = z.infer<typeof planInput>

export const plansInput = z.object({ plans: z.array(planInput).min(1).max(20) })

export type PlansInput = z.infer<typeof plansInput>

/** `"no_ads, early_access"` ⇄ `['no_ads', 'early_access']` for the features text field. */
export const parseFeatureList = (value: string): string[] =>
  value
    .split(/[\s,]+/)
    .map((f) => f.trim())
    .filter((f) => f.length > 0)

export const formatFeatureList = (features: readonly string[]): string => features.join(', ')
