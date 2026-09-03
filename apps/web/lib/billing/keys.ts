import { configValue, resolveConfig } from '../config/store'

/**
 * Billing feature detection (docs/17 §A "Everything is inert without keys", docs/19).
 *
 * Stripe needs the secret key to create Checkout / Portal sessions *and* the webhook secret
 * to verify the events that grant entitlements — with either missing the platform must not
 * pretend to sell anything, so `/subscribe`, `/me/billing` and Admin → Business → Premium
 * render a "not configured" state and every billing route answers 503 instead of throwing.
 *
 * Both keys are resolved panel-first, environment-second, so an operator can paste them into
 * Admin → System → Integrations and have the next request sell. `missing` names the
 * environment variables, matching the copy in `messages.ts` and the panel's own labels.
 */

export interface StripeKeys {
  secretKey: string
  webhookSecret: string
}

export interface BillingKeyStatus {
  secretKey: boolean
  webhookSecret: boolean
  configured: boolean
}

export const stripeKeys = async (): Promise<StripeKeys> => {
  const { values } = await resolveConfig()
  return {
    secretKey: values['payments.stripe_secret_key'] ?? '',
    webhookSecret: values['payments.stripe_webhook_secret'] ?? '',
  }
}

export const stripeSecretKey = async (): Promise<string> =>
  configValue('payments.stripe_secret_key')

export const stripeWebhookSecret = async (): Promise<string> =>
  configValue('payments.stripe_webhook_secret')

/** The pure half, so a test can state the keys instead of arranging a store. */
export const billingKeyStatusOf = (keys: StripeKeys): BillingKeyStatus => ({
  secretKey: !!keys.secretKey,
  webhookSecret: !!keys.webhookSecret,
  configured: !!keys.secretKey && !!keys.webhookSecret,
})

export const billingKeyStatus = async (): Promise<BillingKeyStatus> =>
  billingKeyStatusOf(await stripeKeys())

export const billingConfigured = async (): Promise<boolean> => (await billingKeyStatus()).configured
