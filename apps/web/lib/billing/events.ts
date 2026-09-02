import { z } from 'zod'

/**
 * Stripe payloads are normalised here, with zod, straight from the JSON — never through the
 * SDK's types. Two reasons: a webhook delivery may carry an *older* API version than the one
 * this deployment pins (Stripe replays with the version the endpoint was created on), and the
 * reducer stays testable from fixture files with no SDK and no network (docs/17 §A).
 */

/** The Stripe events this platform acts on (docs/07, docs/17 §A). */
export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid',
  'invoice.payment_succeeded',
  'charge.dispute.created',
] as const

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number]

export const isHandledEvent = (type: string): type is HandledEventType =>
  (HANDLED_EVENT_TYPES as readonly string[]).includes(type)

/** What the reducer does with an event, independent of which Stripe name delivered it. */
export type BillingAction = 'sync' | 'cancel' | 'payment_failed' | 'payment_succeeded' | 'dispute'

export const actionFor = (type: string): BillingAction | null => {
  switch (type) {
    case 'checkout.session.completed':
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return 'sync'
    case 'customer.subscription.deleted':
      return 'cancel'
    case 'invoice.payment_failed':
      return 'payment_failed'
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      return 'payment_succeeded'
    case 'charge.dispute.created':
      return 'dispute'
    default:
      return null
  }
}

const idOf = z.union([z.string(), z.object({ id: z.string() }).loose()]).nullish()

/** `"cus_1"` and `{ id: "cus_1", … }` are both valid Stripe shapes for a linked object. */
export const refId = (value: unknown): string | null => {
  const parsed = idOf.safeParse(value)
  if (!parsed.success || parsed.data == null) return null
  return typeof parsed.data === 'string' ? parsed.data : parsed.data.id
}

const unixSeconds = z.number().int().nonnegative()

export const fromUnix = (seconds: number | null | undefined): Date | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000) : null

export const eventEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: unixSeconds.optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
})

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>

// ---------------------------------------------------------------------------- subscription

const subscriptionItemSchema = z
  .object({
    current_period_end: unixSeconds.nullish(),
    price: z.object({ id: z.string() }).loose().nullish(),
    plan: z.object({ id: z.string() }).loose().nullish(),
  })
  .loose()

const subscriptionSchema = z
  .object({
    id: z.string().min(1),
    object: z.literal('subscription').optional(),
    customer: z.unknown().optional(),
    status: z.string().min(1),
    cancel_at_period_end: z.boolean().nullish(),
    // Removed from the subscription object in 2025-03-31 and later; kept for replays.
    current_period_end: unixSeconds.nullish(),
    ended_at: unixSeconds.nullish(),
    cancel_at: unixSeconds.nullish(),
    items: z
      .object({ data: z.array(subscriptionItemSchema) })
      .loose()
      .nullish(),
    metadata: z.record(z.string(), z.string()).nullish(),
  })
  .loose()

export interface SubscriptionSnapshot {
  stripeSubscriptionId: string
  stripeCustomerId: string | null
  /** Stripe's own status string, stored verbatim in `subscriptions.status`. */
  status: string
  /** Latest period end across the items — what entitlements expire at. */
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  stripePriceId: string | null
  userIdHint: number | null
  planIdHint: string | null
}

const numericMetadata = (value: string | undefined): number | null => {
  if (!value) return null
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

export const parseSubscription = (raw: unknown): SubscriptionSnapshot | null => {
  const parsed = subscriptionSchema.safeParse(raw)
  if (!parsed.success) return null
  const s = parsed.data
  const items = s.items?.data ?? []
  const periods = items
    .map((i) => i.current_period_end)
    .filter((v): v is number => typeof v === 'number')
  const periodEnd =
    periods.length > 0
      ? Math.max(...periods)
      : (s.current_period_end ?? s.ended_at ?? s.cancel_at ?? null)
  const price = items.map((i) => i.price?.id ?? i.plan?.id ?? null).find((id) => !!id) ?? null
  const metadata = s.metadata ?? {}
  return {
    stripeSubscriptionId: s.id,
    stripeCustomerId: refId(s.customer),
    status: s.status,
    currentPeriodEnd: fromUnix(periodEnd),
    cancelAtPeriodEnd: s.cancel_at_period_end === true,
    stripePriceId: price,
    userIdHint: numericMetadata(metadata.user_id),
    planIdHint: metadata.plan_id ?? null,
  }
}

// ------------------------------------------------------------------------- checkout session

const checkoutSessionSchema = z
  .object({
    id: z.string().min(1),
    mode: z.string().nullish(),
    payment_status: z.string().nullish(),
    status: z.string().nullish(),
    customer: z.unknown().optional(),
    subscription: z.unknown().optional(),
    invoice: z.unknown().optional(),
    client_reference_id: z.string().nullish(),
    customer_email: z.string().nullish(),
    metadata: z.record(z.string(), z.string()).nullish(),
  })
  .loose()

export interface CheckoutSnapshot {
  sessionId: string
  mode: string | null
  paid: boolean
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  /** Present only when the session was retrieved with `subscription` expanded. */
  subscription: SubscriptionSnapshot | null
  stripeInvoiceId: string | null
  userIdHint: number | null
  planIdHint: string | null
}

export const parseCheckoutSession = (raw: unknown): CheckoutSnapshot | null => {
  const parsed = checkoutSessionSchema.safeParse(raw)
  if (!parsed.success) return null
  const s = parsed.data
  const metadata = s.metadata ?? {}
  const expanded =
    s.subscription && typeof s.subscription === 'object' ? parseSubscription(s.subscription) : null
  return {
    sessionId: s.id,
    mode: s.mode ?? null,
    paid: s.payment_status === 'paid' || s.payment_status === 'no_payment_required',
    stripeCustomerId: refId(s.customer),
    stripeSubscriptionId: refId(s.subscription),
    subscription: expanded,
    stripeInvoiceId: refId(s.invoice),
    userIdHint: numericMetadata(metadata.user_id ?? s.client_reference_id ?? undefined),
    planIdHint: metadata.plan_id ?? null,
  }
}

// ------------------------------------------------------------------------------- invoice

const invoiceSchema = z
  .object({
    id: z.string().min(1),
    customer: z.unknown().optional(),
    // ≤ 2025-03-31 carried `subscription`; later versions moved it under `parent`.
    subscription: z.unknown().optional(),
    parent: z
      .object({
        subscription_details: z.object({ subscription: z.unknown().optional() }).loose().nullish(),
      })
      .loose()
      .nullish(),
    amount_due: z.number().nullish(),
    amount_paid: z.number().nullish(),
    total: z.number().nullish(),
    currency: z.string().nullish(),
    hosted_invoice_url: z.string().nullish(),
    invoice_pdf: z.string().nullish(),
    number: z.string().nullish(),
    attempt_count: z.number().int().nullish(),
    next_payment_attempt: unixSeconds.nullish(),
    created: unixSeconds.nullish(),
    status_transitions: z.object({ paid_at: unixSeconds.nullish() }).loose().nullish(),
    lines: z
      .object({
        data: z.array(z.object({ description: z.string().nullish() }).loose()),
      })
      .loose()
      .nullish(),
  })
  .loose()

export interface InvoiceSnapshot {
  stripeInvoiceId: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  amountCents: number
  currency: string
  hostedInvoiceUrl: string | null
  invoicePdfUrl: string | null
  description: string | null
  attemptCount: number
  nextAttempt: Date | null
  issuedAt: Date
}

export const parseInvoice = (raw: unknown, now: Date = new Date()): InvoiceSnapshot | null => {
  const parsed = invoiceSchema.safeParse(raw)
  if (!parsed.success) return null
  const i = parsed.data
  const subscription =
    refId(i.subscription) ?? refId(i.parent?.subscription_details?.subscription) ?? null
  // A failed invoice has `amount_paid: 0`; the sum that matters is what was owed.
  const amount = i.total ?? i.amount_due ?? i.amount_paid ?? 0
  return {
    stripeInvoiceId: i.id,
    stripeCustomerId: refId(i.customer),
    stripeSubscriptionId: subscription,
    amountCents: Math.round(amount),
    currency: (i.currency ?? 'usd').toLowerCase(),
    hostedInvoiceUrl: i.hosted_invoice_url ?? null,
    invoicePdfUrl: i.invoice_pdf ?? null,
    description: i.lines?.data?.[0]?.description ?? i.number ?? null,
    attemptCount: i.attempt_count ?? 0,
    nextAttempt: fromUnix(i.next_payment_attempt),
    issuedAt: fromUnix(i.status_transitions?.paid_at ?? i.created) ?? now,
  }
}

// ------------------------------------------------------------------------------- dispute

const disputeSchema = z
  .object({
    id: z.string().min(1),
    charge: z.unknown().optional(),
    payment_intent: z.unknown().optional(),
    amount: z.number().nullish(),
    currency: z.string().nullish(),
    reason: z.string().nullish(),
    status: z.string().nullish(),
    created: unixSeconds.nullish(),
  })
  .loose()

export interface DisputeSnapshot {
  disputeId: string
  chargeId: string | null
  paymentIntentId: string | null
  amountCents: number
  currency: string
  reason: string
  status: string | null
  openedAt: Date | null
}

export const parseDispute = (raw: unknown): DisputeSnapshot | null => {
  const parsed = disputeSchema.safeParse(raw)
  if (!parsed.success) return null
  const d = parsed.data
  return {
    disputeId: d.id,
    chargeId: refId(d.charge),
    paymentIntentId: refId(d.payment_intent),
    amountCents: Math.round(d.amount ?? 0),
    currency: (d.currency ?? 'usd').toLowerCase(),
    reason: d.reason ?? 'unknown',
    status: d.status ?? null,
    openedAt: fromUnix(d.created),
  }
}
