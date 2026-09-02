import { entitlements, getDb, plans, subscriptions, users } from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { type ApplyOutcome, applyBillingEffect } from './apply'
import { getBillingSettings } from './config'
import {
  actionFor,
  type BillingAction,
  type DisputeSnapshot,
  type EventEnvelope,
  eventEnvelopeSchema,
  type InvoiceSnapshot,
  parseCheckoutSession,
  parseDispute,
  parseInvoice,
  parseSubscription,
  type SubscriptionSnapshot,
} from './events'
import { sendBillingNotice } from './notify'
import { planFeatures } from './plans'
import { ENTITLEMENT_SOURCE, emptyEffect, reduceBillingEvent } from './reducer'
import { findUserIdByCustomer, getStripe } from './stripe'

/**
 * Turning a verified Stripe event into rows: resolve the account and the plan (the only steps
 * that need the database or the Stripe API), hand everything to the pure reducer, then write
 * the result in one transaction. Signature verification happens in the route handler, before
 * anything here is called.
 */

export type WebhookOutcome = ApplyOutcome | 'ignored'

export interface WebhookResult {
  outcome: WebhookOutcome
  type: string
  note: string
}

const ignored = (type: string, note: string): WebhookResult => ({ outcome: 'ignored', type, note })

/**
 * Store the event unprocessed and answer 200: Stripe stops retrying, the row stays visible in
 * Admin → Premium as "pending", and nothing half-applied is left behind.
 */
const defer = async (
  event: EventEnvelope,
  payload: Record<string, unknown>,
  note: string,
): Promise<WebhookResult> => {
  const applied = await applyBillingEffect({
    eventId: event.id,
    eventType: event.type,
    payload,
    effect: emptyEffect(note),
    defer: true,
  })
  return {
    outcome: applied.outcome === 'duplicate' ? 'duplicate' : 'deferred',
    type: event.type,
    note,
  }
}

/** Retrieve a subscription when the event only carried its id (invoice / checkout events). */
const retrieveSubscription = async (
  stripe: Stripe | null,
  id: string | null,
): Promise<SubscriptionSnapshot | null> => {
  if (!stripe || !id) return null
  try {
    const raw = await stripe.subscriptions.retrieve(id)
    return parseSubscription(raw)
  } catch {
    return null
  }
}

/** A dispute names a charge, not a customer; the charge is where the customer lives. */
const customerForCharge = async (
  stripe: Stripe | null,
  chargeId: string | null,
): Promise<string | null> => {
  if (!stripe || !chargeId) return null
  try {
    const charge = await stripe.charges.retrieve(chargeId)
    const customer = charge.customer
    return typeof customer === 'string' ? customer : (customer?.id ?? null)
  } catch {
    return null
  }
}

interface Resolved {
  action: BillingAction
  userId: number | null
  stripeCustomerId: string | null
  subscription: SubscriptionSnapshot | null
  invoice: InvoiceSnapshot | null
  dispute: DisputeSnapshot | null
  planIdHint: string | null
  isCheckout: boolean
  note: string
}

const resolveEvent = async (
  envelope: EventEnvelope,
  action: BillingAction,
  stripe: Stripe | null,
  now: Date,
): Promise<Resolved | null> => {
  const object = envelope.data.object
  const base = {
    action,
    userId: null,
    stripeCustomerId: null,
    subscription: null,
    invoice: null,
    dispute: null,
    planIdHint: null,
    isCheckout: false,
    note: '',
  } satisfies Resolved

  if (envelope.type === 'checkout.session.completed') {
    const session = parseCheckoutSession(object)
    if (!session) return null
    if (session.mode !== 'subscription')
      return { ...base, note: 'one-off checkout session, nothing to grant' }
    const subscription =
      session.subscription ?? (await retrieveSubscription(stripe, session.stripeSubscriptionId))
    return {
      ...base,
      subscription,
      stripeCustomerId: session.stripeCustomerId ?? subscription?.stripeCustomerId ?? null,
      userId: session.userIdHint ?? subscription?.userIdHint ?? null,
      planIdHint: session.planIdHint ?? subscription?.planIdHint ?? null,
      isCheckout: true,
      note: session.paid ? 'checkout completed' : 'checkout completed, payment pending',
    }
  }

  if (action === 'sync' || action === 'cancel') {
    const subscription = parseSubscription(object)
    if (!subscription) return null
    return {
      ...base,
      subscription,
      stripeCustomerId: subscription.stripeCustomerId,
      userId: subscription.userIdHint,
      planIdHint: subscription.planIdHint,
      note: `subscription ${subscription.status}`,
    }
  }

  if (action === 'payment_failed' || action === 'payment_succeeded') {
    const invoice = parseInvoice(object, now)
    if (!invoice) return null
    const subscription = await retrieveSubscription(stripe, invoice.stripeSubscriptionId)
    return {
      ...base,
      invoice,
      subscription,
      stripeCustomerId: invoice.stripeCustomerId ?? subscription?.stripeCustomerId ?? null,
      userId: subscription?.userIdHint ?? null,
      planIdHint: subscription?.planIdHint ?? null,
      note: `invoice ${invoice.stripeInvoiceId}`,
    }
  }

  const dispute = parseDispute(object)
  if (!dispute) return null
  return {
    ...base,
    dispute,
    stripeCustomerId: await customerForCharge(stripe, dispute.chargeId),
    note: `dispute ${dispute.disputeId}`,
  }
}

/**
 * Handle one *verified* Stripe event. Never throws for data reasons: an event this platform
 * does not act on is ignored, and one whose account or plan cannot be resolved is stored
 * unprocessed (visible as "pending" in Admin → Premium) so nothing is silently lost.
 */
export const handleStripeEvent = async (
  raw: unknown,
  options: { now?: Date } = {},
): Promise<WebhookResult> => {
  const envelope = eventEnvelopeSchema.safeParse(raw)
  if (!envelope.success) return ignored('unknown', 'unparseable event envelope')
  const event = envelope.data
  const action = actionFor(event.type)
  if (!action) return ignored(event.type, 'event type not handled')

  const now = options.now ?? new Date()
  const stripe = await getStripe()
  const resolved = await resolveEvent(event, action, stripe, now)
  const payload = raw as Record<string, unknown>
  if (!resolved) return ignored(event.type, 'event object did not parse')
  if (!resolved.subscription && !resolved.invoice && !resolved.dispute)
    return ignored(event.type, resolved.note)

  const db = await getDb()

  // ---- who -------------------------------------------------------------------------------
  let userId = resolved.userId
  if (!userId && resolved.stripeCustomerId)
    userId = await findUserIdByCustomer(db, resolved.stripeCustomerId)
  if (!userId && resolved.subscription) {
    const [row] = await db
      .select({ userId: subscriptions.userId })
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, resolved.subscription.stripeSubscriptionId))
      .limit(1)
    userId = row?.userId ?? null
  }
  if (!userId) return defer(event, payload, 'no account matches this Stripe customer')

  // ---- which plan ------------------------------------------------------------------------
  const priceId = resolved.subscription?.stripePriceId ?? null
  let planRow = priceId
    ? ((await db.select().from(plans).where(eq(plans.stripePriceId, priceId)).limit(1))[0] ?? null)
    : null
  if (!planRow && resolved.planIdHint)
    planRow =
      (await db.select().from(plans).where(eq(plans.id, resolved.planIdHint)).limit(1))[0] ?? null
  if (!planRow && resolved.subscription) {
    const [existing] = await db
      .select({ planId: subscriptions.planId })
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, resolved.subscription.stripeSubscriptionId))
      .limit(1)
    if (existing)
      planRow =
        (await db.select().from(plans).where(eq(plans.id, existing.planId)).limit(1))[0] ?? null
  }
  if (resolved.subscription && !planRow)
    return defer(event, payload, `no plan matches price ${priceId ?? '(none)'}`)

  // ---- what they hold today --------------------------------------------------------------
  const held = await db
    .select({ feature: entitlements.feature, expiresAt: entitlements.expiresAt })
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), eq(entitlements.source, ENTITLEMENT_SOURCE)))
  const heldUntil = held.reduce<Date | null>(
    (max, row) => (row.expiresAt && (!max || row.expiresAt > max) ? row.expiresAt : max),
    null,
  )
  const settings = await getBillingSettings(db)

  const effect = reduceBillingEvent({
    action,
    userId,
    planId: planRow?.id ?? null,
    planFeatures: planRow ? planFeatures(planRow) : [],
    existingFeatures: held.map((h) => h.feature),
    existingExpiresAt: heldUntil,
    subscription: resolved.subscription,
    invoice: resolved.invoice,
    dispute: resolved.dispute,
    now,
    graceDays: settings.graceDays,
    isCheckout: resolved.isCheckout,
  })

  const applied = await applyBillingEffect({
    eventId: event.id,
    eventType: event.type,
    payload,
    effect,
    now,
  })

  if (applied.outcome === 'applied' && effect.notify) {
    const [account] = await db
      .select({ email: users.email, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (account?.email)
      await sendBillingNotice(effect.notify, {
        email: account.email,
        name: account.username ?? null,
        expiresAt: effect.entitlements[0]?.expiresAt ?? null,
      })
  }

  return { outcome: applied.outcome, type: event.type, note: effect.note }
}
