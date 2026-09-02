/**
 * Trimmed Stripe webhook payloads, shaped exactly as the API delivers them (2025+ layout,
 * where `current_period_end` lives on the subscription items and an invoice points at its
 * subscription through `parent.subscription_details`). Field-for-field copies of the docs'
 * examples with the noise removed — no network, no SDK, no keys.
 */

export const UNIX = {
  /** 2026-03-01T00:00:00Z */
  periodEnd: 1772323200,
  /** 2026-02-01T00:00:00Z */
  created: 1769904000,
}

export const NOW = new Date('2026-02-20T12:00:00.000Z')

const subscriptionObject = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1MowQVLkdIwHu7ixeRlqHVzs',
  object: 'subscription',
  customer: 'cus_Na6dX7aXxi11N4',
  status: 'active',
  cancel_at_period_end: false,
  created: UNIX.created,
  currency: 'usd',
  items: {
    object: 'list',
    data: [
      {
        id: 'si_Na6dzxczY5fwHx',
        object: 'subscription_item',
        current_period_start: UNIX.created,
        current_period_end: UNIX.periodEnd,
        price: {
          id: 'price_1MowQULkdIwHu7ixraBm864M',
          object: 'price',
          currency: 'usd',
          unit_amount: 500,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      },
    ],
  },
  metadata: { user_id: '42', plan_id: 'premium' },
  ...over,
})

export const subscriptionUpdated = (over: Record<string, unknown> = {}) => ({
  id: 'evt_subscription_updated',
  object: 'event',
  api_version: '2026-08-26.dahlia',
  created: UNIX.created,
  type: 'customer.subscription.updated',
  data: { object: subscriptionObject(over) },
})

export const subscriptionDeleted = () => ({
  id: 'evt_subscription_deleted',
  object: 'event',
  created: UNIX.created,
  type: 'customer.subscription.deleted',
  data: {
    object: subscriptionObject({
      status: 'canceled',
      canceled_at: UNIX.created,
      ended_at: UNIX.periodEnd,
    }),
  },
})

/** The legacy layout: `current_period_end` on the subscription itself. */
export const legacySubscription = () => ({
  id: 'sub_legacy',
  object: 'subscription',
  customer: { id: 'cus_Na6dX7aXxi11N4', object: 'customer' },
  status: 'active',
  cancel_at_period_end: true,
  current_period_end: UNIX.periodEnd,
  plan: { id: 'price_1MowQULkdIwHu7ixraBm864M' },
  items: { object: 'list', data: [{ plan: { id: 'price_1MowQULkdIwHu7ixraBm864M' } }] },
})

export const checkoutCompleted = (over: Record<string, unknown> = {}) => ({
  id: 'evt_checkout_completed',
  object: 'event',
  created: UNIX.created,
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_a1b2c3',
      object: 'checkout.session',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'paid',
      customer: 'cus_Na6dX7aXxi11N4',
      client_reference_id: '42',
      invoice: 'in_1MowQULkdIwHu7ix',
      subscription: subscriptionObject(),
      metadata: { user_id: '42', plan_id: 'premium' },
      ...over,
    },
  },
})

export const invoicePaymentFailed = () => ({
  id: 'evt_invoice_failed',
  object: 'event',
  created: UNIX.created,
  type: 'invoice.payment_failed',
  data: {
    object: {
      id: 'in_1MtHbELkdIwHu7ixl4OzzPMv',
      object: 'invoice',
      customer: 'cus_Na6dX7aXxi11N4',
      currency: 'usd',
      amount_due: 500,
      amount_paid: 0,
      total: 500,
      attempt_count: 1,
      next_payment_attempt: UNIX.created + 3 * 86_400,
      created: UNIX.created,
      number: 'PALSCANS-0007',
      hosted_invoice_url: 'https://invoice.stripe.com/i/acct_1/test_in_1',
      invoice_pdf: 'https://pay.stripe.com/invoice/acct_1/test_in_1/pdf',
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: 'sub_1MowQVLkdIwHu7ixeRlqHVzs' },
      },
      lines: { object: 'list', data: [{ description: 'PALScans Premium · monthly' }] },
      status: 'open',
    },
  },
})

export const invoicePaid = () => ({
  id: 'evt_invoice_paid',
  object: 'event',
  created: UNIX.created,
  type: 'invoice.paid',
  data: {
    object: {
      id: 'in_paid_1',
      object: 'invoice',
      customer: 'cus_Na6dX7aXxi11N4',
      currency: 'usd',
      amount_paid: 500,
      total: 500,
      created: UNIX.created,
      status_transitions: { paid_at: UNIX.created + 60 },
      hosted_invoice_url: 'https://invoice.stripe.com/i/acct_1/test_in_paid',
      invoice_pdf: 'https://pay.stripe.com/invoice/acct_1/test_in_paid/pdf',
      subscription: 'sub_1MowQVLkdIwHu7ixeRlqHVzs',
      lines: { object: 'list', data: [{ description: 'PALScans Premium · monthly' }] },
      status: 'paid',
    },
  },
})

export const disputeCreated = () => ({
  id: 'evt_dispute_created',
  object: 'event',
  created: UNIX.created,
  type: 'charge.dispute.created',
  data: {
    object: {
      id: 'dp_1MtJUT2eZvKYlo2C9OBqB4Ez',
      object: 'dispute',
      amount: 500,
      currency: 'usd',
      charge: 'ch_1AZtxr2eZvKYlo2CJDXlOxvS',
      payment_intent: 'pi_1AZtxr2eZvKYlo2CJDXlOxvS',
      reason: 'fraudulent',
      status: 'warning_needs_response',
      created: UNIX.created,
    },
  },
})
