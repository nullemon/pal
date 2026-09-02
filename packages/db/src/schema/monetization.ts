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

export const promoCodes = pgTable('promo_codes', {
  id: identity(),
  code: text('code').notNull().unique(),
  feature: text('feature').notNull(),
  durationDays: integer('duration_days'),
  maxRedemptions: integer('max_redemptions'),
  redemptions: integer('redemptions').notNull().default(0),
  expiresAt: timestamptz('expires_at'),
  createdBy: ref('created_by').references(() => users.id),
  createdAt: createdAt(),
})
