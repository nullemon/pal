import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { createdAt, identity, ref, timestamptz, updatedAt } from './_shared.js'
import { users } from './identity.js'

export const plans = pgTable('plans', {
  id: text('id').primaryKey(), // 'supporter' | 'premium'
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  interval: text('interval').notNull(), // 'month' | 'year'
  stripePriceId: text('stripe_price_id').notNull(),
  /** Entitlement features the plan grants (agent A, 9008): the operator edits these, not code. */
  features: text('features').array().notNull().default(sql`'{}'::text[]`),
  /** Off keeps the plan for existing subscribers but hides it from /subscribe. */
  active: boolean('active').notNull().default(true),
})

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: identity(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
    status: text('status').notNull(), // mirrors Stripe
    currentPeriodEnd: timestamptz('current_period_end').notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('subscriptions_active_user_idx')
      .on(t.userId)
      .where(sql`${t.status} IN ('active', 'trialing', 'past_due')`),
  ],
)

/** The single source of truth the app reads. Never inferred from users.role. */
export const entitlements = pgTable(
  'entitlements',
  {
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(), // 'early_access' | 'premium_content' | 'offline' | 'no_ads'
    source: text('source').notNull(), // 'subscription' | 'grant' | 'promo'
    expiresAt: timestamptz('expires_at'), // null = permanent
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.feature] }),
    index('entitlements_expires_at_idx').on(t.expiresAt).where(sql`${t.expiresAt} IS NOT NULL`),
  ],
)

/** Idempotency for Stripe redelivery. */
export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(), // Stripe event id
  type: text('type').notNull(),
  processedAt: timestamptz('processed_at'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
})

/*
 * `promo_codes` was dropped in migration 9017. Two shipped surfaces already covered it from
 * both ends and nothing ever read it:
 *
 *   - a discount on a subscription is Stripe's job, and `POST /api/billing/checkout` already
 *     passes `allow_promotion_codes: true`, so a code created in the Stripe dashboard works
 *     today with percent/amount off, first-N-months, per-customer and currency rules this
 *     table could not express;
 *   - a comped *feature* for N days is an admin grant, which `PATCH /api/admin/users/:id`
 *     already writes straight into `entitlements` with an expiry.
 *
 * `entitlements.source` is free text and still documents 'promo', so a redemption path can
 * be added later without a schema change here.
 */

/**
 * The Stripe customer behind an account, written before the first Checkout session so a
 * webhook can resolve the user from `customer` alone (agent A, docs/07).
 */
export const billingCustomers = pgTable('billing_customers', {
  userId: ref('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Invoice history for /me/billing — "receipts linked from the account page" (docs/07). */
export const billingReceipts = pgTable(
  'billing_receipts',
  {
    id: identity(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stripeInvoiceId: text('stripe_invoice_id').notNull().unique(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    description: text('description'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('usd'),
    status: text('status').notNull(), // paid | failed | disputed
    hostedInvoiceUrl: text('hosted_invoice_url'),
    invoicePdfUrl: text('invoice_pdf_url'),
    issuedAt: timestamptz('issued_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('billing_receipts_user_idx').on(t.userId, t.issuedAt.desc())],
)
