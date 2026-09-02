import { describe, expect, it } from 'vitest'
import {
  checkoutCompleted,
  disputeCreated,
  invoicePaid,
  invoicePaymentFailed,
  legacySubscription,
  NOW,
  subscriptionDeleted,
  subscriptionUpdated,
  UNIX,
} from './__fixtures__/stripe-events'
import {
  actionFor,
  isHandledEvent,
  parseCheckoutSession,
  parseDispute,
  parseInvoice,
  parseSubscription,
} from './events'
import { entitlementExpiry, type ReduceInput, reduceBillingEvent } from './reducer'

/**
 * The webhook reducer, from fixture payloads: event → the `subscriptions` and `entitlements`
 * rows the transaction writes (docs/07). No network, no database, no keys.
 */

const PREMIUM = ['no_ads', 'early_access', 'premium_content', 'offline'] as const
const SUPPORTER = ['no_ads'] as const
const periodEnd = new Date(UNIX.periodEnd * 1000)

const base = (over: Partial<ReduceInput>): ReduceInput => ({
  action: 'sync',
  userId: 42,
  planId: 'premium',
  planFeatures: PREMIUM,
  existingFeatures: [],
  now: NOW,
  ...over,
})

const expiryOf = (rows: { feature: string; expiresAt: Date }[], feature: string) =>
  rows.find((r) => r.feature === feature)?.expiresAt

describe('event normalisation', () => {
  it('maps the handled Stripe event names to actions', () => {
    expect(actionFor('checkout.session.completed')).toBe('sync')
    expect(actionFor('customer.subscription.updated')).toBe('sync')
    expect(actionFor('customer.subscription.deleted')).toBe('cancel')
    expect(actionFor('invoice.payment_failed')).toBe('payment_failed')
    expect(actionFor('invoice.paid')).toBe('payment_succeeded')
    expect(actionFor('charge.dispute.created')).toBe('dispute')
    expect(actionFor('customer.created')).toBeNull()
    expect(isHandledEvent('charge.dispute.created')).toBe(true)
    expect(isHandledEvent('payout.paid')).toBe(false)
  })

  it('reads the period end from the subscription items (2025+ layout)', () => {
    const snap = parseSubscription(subscriptionUpdated().data.object)
    expect(snap).not.toBeNull()
    expect(snap?.stripeSubscriptionId).toBe('sub_1MowQVLkdIwHu7ixeRlqHVzs')
    expect(snap?.stripeCustomerId).toBe('cus_Na6dX7aXxi11N4')
    expect(snap?.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString())
    expect(snap?.stripePriceId).toBe('price_1MowQULkdIwHu7ixraBm864M')
    expect(snap?.userIdHint).toBe(42)
    expect(snap?.planIdHint).toBe('premium')
  })

  it('still reads a replayed payload with the legacy top-level period end', () => {
    const snap = parseSubscription(legacySubscription())
    expect(snap?.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString())
    expect(snap?.cancelAtPeriodEnd).toBe(true)
    // `customer` expanded to an object, and the price only on the item's `plan`.
    expect(snap?.stripeCustomerId).toBe('cus_Na6dX7aXxi11N4')
    expect(snap?.stripePriceId).toBe('price_1MowQULkdIwHu7ixraBm864M')
  })

  it('reads the checkout session, its expanded subscription and the account hint', () => {
    const session = parseCheckoutSession(checkoutCompleted().data.object)
    expect(session?.mode).toBe('subscription')
    expect(session?.paid).toBe(true)
    expect(session?.userIdHint).toBe(42)
    expect(session?.subscription?.stripeSubscriptionId).toBe('sub_1MowQVLkdIwHu7ixeRlqHVzs')
    expect(session?.stripeInvoiceId).toBe('in_1MowQULkdIwHu7ix')
  })

  it('finds the subscription behind an invoice in both layouts', () => {
    const failed = parseInvoice(invoicePaymentFailed().data.object)
    expect(failed?.stripeSubscriptionId).toBe('sub_1MowQVLkdIwHu7ixeRlqHVzs')
    expect(failed?.amountCents).toBe(500)
    expect(failed?.hostedInvoiceUrl).toContain('invoice.stripe.com')
    const paid = parseInvoice(invoicePaid().data.object)
    expect(paid?.stripeSubscriptionId).toBe('sub_1MowQVLkdIwHu7ixeRlqHVzs')
    expect(paid?.issuedAt.toISOString()).toBe(new Date((UNIX.created + 60) * 1000).toISOString())
  })

  it('reads a dispute', () => {
    const dispute = parseDispute(disputeCreated().data.object)
    expect(dispute?.chargeId).toBe('ch_1AZtxr2eZvKYlo2CJDXlOxvS')
    expect(dispute?.reason).toBe('fraudulent')
    expect(dispute?.amountCents).toBe(500)
  })

  it('returns null for a payload that is not the object it claims to be', () => {
    expect(parseSubscription({ nothing: true })).toBeNull()
    expect(parseInvoice(null)).toBeNull()
  })
})

describe('entitlementExpiry', () => {
  it('grants to the end of the paid period while active', () => {
    expect(entitlementExpiry('active', periodEnd, NOW)?.toISOString()).toBe(periodEnd.toISOString())
    expect(entitlementExpiry('trialing', periodEnd, NOW)?.toISOString()).toBe(
      periodEnd.toISOString(),
    )
  })

  it('adds the grace window on past_due, never shortening the paid period', () => {
    // Period ends after the grace window: the paid period wins.
    expect(entitlementExpiry('past_due', periodEnd, NOW, 3)?.toISOString()).toBe(
      periodEnd.toISOString(),
    )
    // Period already over: three days from now (docs/07).
    const lapsed = new Date('2026-02-19T00:00:00.000Z')
    expect(entitlementExpiry('past_due', lapsed, NOW, 3)?.toISOString()).toBe(
      '2026-02-23T12:00:00.000Z',
    )
    expect(entitlementExpiry('past_due', lapsed, NOW, 7)?.toISOString()).toBe(
      '2026-02-27T12:00:00.000Z',
    )
  })

  it('lets a cancellation run to the period end and grants nothing when nothing was paid', () => {
    expect(entitlementExpiry('canceled', periodEnd, NOW)?.toISOString()).toBe(
      periodEnd.toISOString(),
    )
    expect(entitlementExpiry('incomplete', periodEnd, NOW)).toBeNull()
    expect(entitlementExpiry('incomplete_expired', periodEnd, NOW)).toBeNull()
  })
})

describe('reduceBillingEvent', () => {
  it('checkout.session.completed writes the subscription and every plan feature', () => {
    const snapshot = parseSubscription(checkoutCompleted().data.object.subscription)
    const effect = reduceBillingEvent(
      base({ subscription: snapshot, isCheckout: true, action: 'sync' }),
    )
    expect(effect.subscription).toEqual({
      userId: 42,
      planId: 'premium',
      stripeCustomerId: 'cus_Na6dX7aXxi11N4',
      stripeSubscriptionId: 'sub_1MowQVLkdIwHu7ixeRlqHVzs',
      status: 'active',
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    })
    expect(effect.entitlements.map((e) => e.feature).sort()).toEqual([...PREMIUM].sort())
    for (const row of effect.entitlements) {
      expect(row.source).toBe('subscription')
      expect(row.expiresAt.toISOString()).toBe(periodEnd.toISOString())
    }
    expect(effect.notify).toBe('subscription_started')
    expect(effect.ticket).toBeNull()
  })

  it('past_due keeps the perks alive for the grace window and records the failed invoice', () => {
    const lapsed = subscriptionUpdated({
      status: 'past_due',
      items: {
        object: 'list',
        data: [
          {
            current_period_end: Math.floor(NOW.getTime() / 1000) - 86_400,
            price: { id: 'price_1MowQULkdIwHu7ixraBm864M' },
          },
        ],
      },
    })
    const effect = reduceBillingEvent(
      base({
        action: 'payment_failed',
        subscription: parseSubscription(lapsed.data.object),
        invoice: parseInvoice(invoicePaymentFailed().data.object),
        existingFeatures: PREMIUM,
        graceDays: 3,
      }),
    )
    expect(effect.subscription?.status).toBe('past_due')
    expect(expiryOf(effect.entitlements, 'premium_content')?.toISOString()).toBe(
      '2026-02-23T12:00:00.000Z',
    )
    expect(effect.receipt).toMatchObject({
      status: 'failed',
      amountCents: 500,
      stripeInvoiceId: 'in_1MtHbELkdIwHu7ixl4OzzPMv',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1/test_in_1',
    })
    expect(effect.notify).toBe('payment_failed')
  })

  it('a failed payment never shortens a period the reader already paid for', () => {
    const effect = reduceBillingEvent(
      base({
        action: 'payment_failed',
        // The invoice arrived without its subscription (the retrieve failed offline).
        subscription: null,
        invoice: parseInvoice(invoicePaymentFailed().data.object),
        existingFeatures: PREMIUM,
        existingExpiresAt: periodEnd,
        graceDays: 3,
      }),
    )
    expect(effect.subscription).toBeNull()
    for (const row of effect.entitlements)
      expect(row.expiresAt.toISOString()).toBe(periodEnd.toISOString())
    expect(effect.receipt?.status).toBe('failed')
  })

  it('a cancellation expires at the period end, never immediately', () => {
    const effect = reduceBillingEvent(
      base({
        action: 'cancel',
        subscription: parseSubscription(subscriptionDeleted().data.object),
        existingFeatures: PREMIUM,
      }),
    )
    expect(effect.subscription?.status).toBe('canceled')
    expect(effect.entitlements).toHaveLength(PREMIUM.length)
    for (const row of effect.entitlements)
      expect(row.expiresAt.toISOString()).toBe(periodEnd.toISOString())
    expect(effect.notify).toBe('subscription_canceled')
  })

  it('a downgrade expires the features the new plan does not include', () => {
    const effect = reduceBillingEvent(
      base({
        planId: 'supporter',
        planFeatures: SUPPORTER,
        existingFeatures: PREMIUM,
        subscription: parseSubscription(subscriptionUpdated().data.object),
      }),
    )
    expect(expiryOf(effect.entitlements, 'no_ads')?.toISOString()).toBe(periodEnd.toISOString())
    for (const feature of ['early_access', 'premium_content', 'offline'])
      expect(expiryOf(effect.entitlements, feature)?.toISOString()).toBe(NOW.toISOString())
  })

  it('an incomplete subscription grants nothing and expires anything it had', () => {
    const effect = reduceBillingEvent(
      base({
        subscription: parseSubscription(subscriptionUpdated({ status: 'incomplete' }).data.object),
        existingFeatures: ['no_ads'],
      }),
    )
    expect(effect.subscription?.status).toBe('incomplete')
    expect(effect.entitlements).toEqual([
      { userId: 42, feature: 'no_ads', source: 'subscription', expiresAt: NOW },
    ])
  })

  it('a paid invoice stores the receipt with its links', () => {
    const effect = reduceBillingEvent(
      base({
        action: 'payment_succeeded',
        subscription: parseSubscription(subscriptionUpdated().data.object),
        invoice: parseInvoice(invoicePaid().data.object),
      }),
    )
    expect(effect.receipt).toMatchObject({
      status: 'paid',
      stripeInvoiceId: 'in_paid_1',
      invoicePdfUrl: 'https://pay.stripe.com/invoice/acct_1/test_in_paid/pdf',
    })
    expect(effect.notify).toBeNull()
    expect(expiryOf(effect.entitlements, 'offline')?.toISOString()).toBe(periodEnd.toISOString())
  })

  it('a dispute suspends every subscription perk now and opens a billing ticket', () => {
    const effect = reduceBillingEvent(
      base({
        action: 'dispute',
        dispute: parseDispute(disputeCreated().data.object),
        existingFeatures: PREMIUM,
      }),
    )
    expect(effect.subscription).toBeNull()
    expect(effect.entitlements).toHaveLength(PREMIUM.length)
    for (const row of effect.entitlements)
      expect(row.expiresAt.toISOString()).toBe(NOW.toISOString())
    expect(effect.ticket).toMatchObject({
      kind: 'billing',
      targetType: 'user',
      targetId: 42,
      reason: 'chargeback',
    })
    expect(effect.ticket?.payload.dispute_id).toBe('dp_1MtJUT2eZvKYlo2C9OBqB4Ez')
    expect(effect.ticket?.payload.charge_id).toBe('ch_1AZtxr2eZvKYlo2CJDXlOxvS')
    expect(effect.notify).toBe('dispute_opened')
  })

  it('writes no subscription row when the plan behind the price is unknown', () => {
    const effect = reduceBillingEvent(
      base({
        planId: null,
        planFeatures: [],
        subscription: parseSubscription(subscriptionUpdated().data.object),
      }),
    )
    expect(effect.subscription).toBeNull()
    expect(effect.entitlements).toEqual([])
  })

  it('an event with no subscription on it writes nothing', () => {
    const effect = reduceBillingEvent(base({ subscription: null }))
    expect(effect.subscription).toBeNull()
    expect(effect.entitlements).toEqual([])
    expect(effect.note).toContain('no subscription')
  })
})
