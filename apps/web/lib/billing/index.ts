/**
 * `@/lib/billing` — Stripe Checkout, the Customer Portal and the webhook reducer (docs/07,
 * docs/17 §A). Everything here is inert without a Stripe secret key and webhook signing
 * secret: `billingConfigured()` (./keys.ts) is the one switch, the routes answer 503 with a
 * message, and the pages render a "not configured" state. Both keys come from the admin
 * panel first and the environment second (docs/19).
 */

export type { AccountBilling, AccountReceipt, AccountSubscription } from './account'
export { accountBilling } from './account'
export type { ApplyInput, ApplyOutcome, ApplyResult } from './apply'
export { applyBillingEffect } from './apply'
export { getBillingSettings } from './config'
export type {
  BillingAction,
  CheckoutSnapshot,
  DisputeSnapshot,
  HandledEventType,
  InvoiceSnapshot,
  SubscriptionSnapshot,
} from './events'
export {
  actionFor,
  HANDLED_EVENT_TYPES,
  isHandledEvent,
  parseCheckoutSession,
  parseDispute,
  parseInvoice,
  parseSubscription,
} from './events'
export type { BillingKeyStatus, StripeKeys } from './keys'
export {
  billingConfigured,
  billingKeyStatus,
  billingKeyStatusOf,
  stripeKeys,
  stripeSecretKey,
  stripeWebhookSecret,
} from './keys'
export { sendBillingNotice } from './notify'
export type { BillingPlan } from './plans'
export {
  DEFAULT_PLAN_FEATURES,
  formatPrice,
  isPlaceholderPrice,
  isSellable,
  listPlans,
  planFeatures,
} from './plans'
export type { BillingEffect, BillingNotice, EntitlementWrite, SubscriptionWrite } from './reducer'
export { entitlementExpiry, reduceBillingEvent } from './reducer'
export type { BillingSettings } from './settings'
export {
  BILLING_SETTINGS_KEY,
  billingSettingsSchema,
  DEFAULT_BILLING_SETTINGS,
  DEFAULT_GRACE_DAYS,
  parseBillingSettings,
} from './settings'
export {
  ensureCustomer,
  findCustomerId,
  findUserIdByCustomer,
  getStripe,
  linkCustomer,
} from './stripe'
export type { WebhookResult } from './webhook'
export { handleStripeEvent } from './webhook'
