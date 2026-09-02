import { z } from 'zod'

/**
 * `settings.billing` — the operator-controlled half of billing (docs/17 §A). Keys, prices and
 * the webhook secret live in the environment; everything an operator changes at runtime lives
 * here, next to `ads`, `layouts` and `comments`. This module stays free of database and
 * server-only imports so the admin panel can validate against the same schema.
 */
export const BILLING_SETTINGS_KEY = 'billing'

/** docs/07: "on `past_due`, keep entitlements alive for 3 days and email". */
export const DEFAULT_GRACE_DAYS = 3

export const billingSettingsSchema = z.object({
  /** Days a `past_due` subscription keeps its entitlements before they lapse. */
  graceDays: z.number().int().min(0).max(30).default(DEFAULT_GRACE_DAYS),
  /** Stripe Tax on the Checkout session (docs/07 "Stripe Tax on"). */
  taxEnabled: z.boolean().default(true),
  /** Collect a VAT / GST number at checkout (only meaningful with tax on). */
  taxIdCollection: z.boolean().default(true),
  /** The Customer Portal handles cancel, plan change and card update. */
  portalEnabled: z.boolean().default(true),
  /** Statement descriptor readers will recognise on the card statement (≤ 22 chars). */
  statementDescriptor: z.string().trim().max(22).default('PALSCANS'),
  /** Where "billing help" points — the frustrated path leads here, not to the bank (docs/07). */
  supportPath: z.string().trim().max(200).default('/contact'),
})

export type BillingSettings = z.infer<typeof billingSettingsSchema>

export const DEFAULT_BILLING_SETTINGS: BillingSettings = billingSettingsSchema.parse({})

/** Never throws: an unknown or half-written value falls back to the defaults, field by field. */
export const parseBillingSettings = (raw: unknown): BillingSettings => {
  const parsed = billingSettingsSchema.safeParse(raw ?? {})
  if (parsed.success) return parsed.data
  const source = (raw ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = { ...DEFAULT_BILLING_SETTINGS }
  for (const [key, value] of Object.entries(source)) {
    const shape = billingSettingsSchema.shape as Record<string, z.ZodTypeAny>
    const field = shape[key]
    if (!field) continue
    const one = field.safeParse(value)
    if (one.success) out[key] = one.data
  }
  return out as BillingSettings
}
