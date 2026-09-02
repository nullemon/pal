import type {
  BillingAction,
  DisputeSnapshot,
  InvoiceSnapshot,
  SubscriptionSnapshot,
} from './events'
import { DEFAULT_GRACE_DAYS } from './settings'

/**
 * The webhook reducer: one pure function from a normalised Stripe event to the rows the
 * platform writes (docs/07 "each writes `subscriptions` **and** the derived `entitlements`
 * rows in one transaction"). It touches nothing — no database, no network, no clock — so the
 * rules that decide who keeps access are unit-testable from fixture payloads.
 *
 * Rules, in one place:
 * - `active` / `trialing` — entitlements last until `current_period_end`.
 * - `past_due` — a grace window (3 days by default) on top of the period, never less.
 * - `canceled` / `unpaid` / `paused` — entitlements expire **at the period end**, never
 *   immediately: the month was paid for.
 * - `incomplete` / `incomplete_expired` — nothing was ever paid, so nothing is granted.
 * - a dispute suspends every subscription-sourced entitlement now and opens a billing ticket
 *   rather than touching the account (docs/07 "Chargebacks").
 * - features the plan no longer includes (a downgrade) expire with the same event.
 */

export type SubscriptionSource = 'subscription'

export const ENTITLEMENT_SOURCE: SubscriptionSource = 'subscription'

/** Statuses in which Stripe considers money to have been taken for the current period. */
const PAID_STATUSES = new Set(['active', 'trialing'])
/** Statuses where the paid period still stands but the subscription is over or stalled. */
const RUNS_OUT_STATUSES = new Set(['canceled', 'unpaid', 'paused'])
/** Statuses where nothing was ever paid. */
const NEVER_PAID_STATUSES = new Set(['incomplete', 'incomplete_expired'])

export interface SubscriptionWrite {
  userId: number
  planId: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  status: string
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
}

export interface EntitlementWrite {
  userId: number
  feature: string
  source: SubscriptionSource
  /** `null` never happens for subscription rows — a subscription always has an end. */
  expiresAt: Date
}

export interface ReceiptWrite {
  userId: number
  stripeInvoiceId: string
  stripeSubscriptionId: string | null
  description: string | null
  amountCents: number
  currency: string
  status: 'paid' | 'failed'
  hostedInvoiceUrl: string | null
  invoicePdfUrl: string | null
  issuedAt: Date
}

export interface TicketWrite {
  kind: 'billing'
  targetType: 'user'
  targetId: number
  reason: string
  detail: string
  payload: Record<string, unknown>
}

export type BillingNotice =
  | 'subscription_started'
  | 'subscription_canceled'
  | 'payment_failed'
  | 'dispute_opened'

export interface BillingEffect {
  /** Upsert on `stripe_subscription_id`; null when the event carries no usable subscription. */
  subscription: SubscriptionWrite | null
  /** Upsert on (user, feature) — only rows whose source is already `subscription`. */
  entitlements: EntitlementWrite[]
  receipt: ReceiptWrite | null
  ticket: TicketWrite | null
  notify: BillingNotice | null
  /** Human-readable trace, stored on the audit row. */
  note: string
}

export interface ReduceInput {
  action: BillingAction
  /** The resolved account. */
  userId: number
  /** The resolved plan; null when the price is unknown to this platform. */
  planId: string | null
  /** What the plan grants (from `plans.features`). */
  planFeatures: readonly string[]
  /** Subscription-sourced features the user holds right now, so a downgrade can expire them. */
  existingFeatures?: readonly string[]
  /**
   * The furthest expiry those rows already carry. A failed payment must never *shorten* a
   * period the reader has paid for — the grace window can only push it out.
   */
  existingExpiresAt?: Date | null
  subscription?: SubscriptionSnapshot | null
  invoice?: InvoiceSnapshot | null
  dispute?: DisputeSnapshot | null
  now: Date
  graceDays?: number
  /** True on `checkout.session.completed` — the only event that means "a new subscriber". */
  isCheckout?: boolean
}

export const emptyEffect = (note: string): BillingEffect => ({
  subscription: null,
  entitlements: [],
  receipt: null,
  ticket: null,
  notify: null,
  note,
})

const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000)

const latest = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b)

/**
 * When a subscription in `status` stops granting access. `null` means "grant nothing".
 * Exported because it is the rule the whole feature turns on.
 */
export const entitlementExpiry = (
  status: string,
  currentPeriodEnd: Date | null,
  now: Date,
  graceDays: number = DEFAULT_GRACE_DAYS,
): Date | null => {
  if (NEVER_PAID_STATUSES.has(status)) return null
  if (status === 'past_due') {
    const grace = addDays(now, graceDays)
    return currentPeriodEnd ? latest(currentPeriodEnd, grace) : grace
  }
  if (PAID_STATUSES.has(status) || RUNS_OUT_STATUSES.has(status)) return currentPeriodEnd
  // An unknown status (Stripe adds them) is treated like the paid period running out.
  return currentPeriodEnd
}

const uniqueFeatures = (...lists: readonly (readonly string[] | undefined)[]): string[] => {
  const seen = new Set<string>()
  for (const list of lists) for (const f of list ?? []) if (f) seen.add(f)
  return [...seen]
}

/** Grant `granted` until `expiresAt`, and expire everything else the subscription had. */
const entitlementRows = (
  userId: number,
  granted: readonly string[],
  previouslyHeld: readonly string[] | undefined,
  expiresAt: Date | null,
  now: Date,
): EntitlementWrite[] => {
  const grantedSet = new Set<string>(expiresAt ? granted : [])
  const rows: EntitlementWrite[] = []
  if (expiresAt)
    for (const feature of grantedSet)
      rows.push({ userId, feature, source: ENTITLEMENT_SOURCE, expiresAt })
  // A downgrade (or a never-paid subscription) expires what the plan no longer covers. Only
  // rows the user actually holds are touched, so no dead rows are invented.
  for (const feature of previouslyHeld ?? [])
    if (!grantedSet.has(feature))
      rows.push({ userId, feature, source: ENTITLEMENT_SOURCE, expiresAt: now })
  return rows
}

const subscriptionWrite = (
  input: ReduceInput,
  snapshot: SubscriptionSnapshot,
  status: string,
): SubscriptionWrite | null => {
  if (!input.planId || !snapshot.stripeCustomerId || !snapshot.currentPeriodEnd) return null
  return {
    userId: input.userId,
    planId: input.planId,
    stripeCustomerId: snapshot.stripeCustomerId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    status,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
  }
}

const syncEffect = (input: ReduceInput, status: string): BillingEffect => {
  const snapshot = input.subscription
  if (!snapshot) return emptyEffect('no subscription on the event')
  const grace = input.graceDays ?? DEFAULT_GRACE_DAYS
  const expiresAt = entitlementExpiry(status, snapshot.currentPeriodEnd, input.now, grace)
  const effect: BillingEffect = {
    subscription: subscriptionWrite(input, snapshot, status),
    entitlements: entitlementRows(
      input.userId,
      input.planFeatures,
      input.existingFeatures,
      expiresAt,
      input.now,
    ),
    receipt: null,
    ticket: null,
    notify: input.isCheckout
      ? 'subscription_started'
      : status === 'canceled'
        ? 'subscription_canceled'
        : null,
    note: `${status}${expiresAt ? ` until ${expiresAt.toISOString()}` : ' — no entitlements'}`,
  }
  return effect
}

export const reduceBillingEvent = (input: ReduceInput): BillingEffect => {
  switch (input.action) {
    case 'sync':
      return syncEffect(input, input.subscription?.status ?? 'incomplete')

    case 'cancel': {
      // docs/07: canceled expires at current_period_end, never immediately.
      const effect = syncEffect(input, 'canceled')
      return { ...effect, notify: 'subscription_canceled' }
    }

    case 'payment_failed': {
      const invoice = input.invoice
      const grace = input.graceDays ?? DEFAULT_GRACE_DAYS
      // The subscription is usually already `past_due` here; if the event arrived without one,
      // the grace window still applies from now.
      const status = input.subscription?.status ?? 'past_due'
      const computed = entitlementExpiry(
        status === 'active' ? 'past_due' : status,
        input.subscription?.currentPeriodEnd ?? null,
        input.now,
        grace,
      )
      // The invoice event may arrive without its subscription (the retrieve failed, or the
      // event was replayed offline): the grace window then extends what the reader already
      // holds instead of replacing it.
      const expiresAt =
        computed && input.existingExpiresAt ? latest(computed, input.existingExpiresAt) : computed
      const held = uniqueFeatures(input.existingFeatures, input.planFeatures)
      return {
        subscription: input.subscription
          ? subscriptionWrite(input, input.subscription, status)
          : null,
        entitlements: expiresAt
          ? held.map((feature) => ({
              userId: input.userId,
              feature,
              source: ENTITLEMENT_SOURCE,
              expiresAt,
            }))
          : [],
        receipt: invoice
          ? {
              userId: input.userId,
              stripeInvoiceId: invoice.stripeInvoiceId,
              stripeSubscriptionId: invoice.stripeSubscriptionId,
              description: invoice.description,
              amountCents: invoice.amountCents,
              currency: invoice.currency,
              status: 'failed',
              hostedInvoiceUrl: invoice.hostedInvoiceUrl,
              invoicePdfUrl: invoice.invoicePdfUrl,
              issuedAt: invoice.issuedAt,
            }
          : null,
        ticket: null,
        notify: 'payment_failed',
        note: `payment failed, grace ${grace}d${expiresAt ? ` until ${expiresAt.toISOString()}` : ''}`,
      }
    }

    case 'payment_succeeded': {
      const invoice = input.invoice
      const base = input.subscription
        ? syncEffect(input, input.subscription.status)
        : emptyEffect('invoice paid')
      return {
        ...base,
        notify: null,
        receipt: invoice
          ? {
              userId: input.userId,
              stripeInvoiceId: invoice.stripeInvoiceId,
              stripeSubscriptionId: invoice.stripeSubscriptionId,
              description: invoice.description,
              amountCents: invoice.amountCents,
              currency: invoice.currency,
              status: 'paid',
              hostedInvoiceUrl: invoice.hostedInvoiceUrl,
              invoicePdfUrl: invoice.invoicePdfUrl,
              issuedAt: invoice.issuedAt,
            }
          : null,
        note: 'invoice paid',
      }
    }

    case 'dispute': {
      // docs/07: suspend entitlements and open a ticket — never delete the account.
      const dispute = input.dispute
      const suspended = uniqueFeatures(input.existingFeatures, input.planFeatures)
      return {
        subscription: null,
        entitlements: suspended.map((feature) => ({
          userId: input.userId,
          feature,
          source: ENTITLEMENT_SOURCE,
          expiresAt: input.now,
        })),
        receipt: null,
        ticket: {
          kind: 'billing',
          targetType: 'user',
          targetId: input.userId,
          reason: 'chargeback',
          detail: dispute
            ? `Dispute ${dispute.disputeId} (${dispute.reason}) on charge ${dispute.chargeId ?? 'unknown'}.`
            : 'Card dispute opened.',
          payload: {
            dispute_id: dispute?.disputeId ?? null,
            charge_id: dispute?.chargeId ?? null,
            amount_cents: dispute?.amountCents ?? null,
            currency: dispute?.currency ?? null,
            reason: dispute?.reason ?? null,
            suspended_features: suspended,
          },
        },
        notify: 'dispute_opened',
        note: `dispute — suspended ${suspended.length} entitlement(s)`,
      }
    }

    default:
      return emptyEffect('unhandled action')
  }
}
