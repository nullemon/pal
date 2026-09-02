import {
  auditLog,
  billingReceipts,
  type Db,
  entitlements,
  getDb,
  reports,
  subscriptions,
  webhookEvents,
} from '@palscans/db'
import { and, eq, sql } from 'drizzle-orm'
import { type BillingEffect, ENTITLEMENT_SOURCE } from './reducer'

/**
 * Applying an effect: one transaction per Stripe event, idempotent on the event id through
 * `webhook_events` (docs/07). Nothing here decides anything — `reduceBillingEvent` already did.
 */

export type ApplyOutcome = 'applied' | 'duplicate' | 'deferred'

export interface ApplyInput {
  eventId: string
  eventType: string
  payload: Record<string, unknown>
  effect: BillingEffect
  /** Leave the event unprocessed (so it stays visible as pending) without writing rows. */
  defer?: boolean
  now?: Date
}

export interface ApplyResult {
  outcome: ApplyOutcome
  note: string
}

/**
 * Claim the event row. Returns false when another delivery already finished it: the insert
 * either wins (fresh event), or conflicts and then locks the existing row — so two concurrent
 * deliveries of the same event serialise here instead of both writing entitlements.
 */
const claimEvent = async (
  tx: Db,
  eventId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<boolean> => {
  const inserted = await tx
    .insert(webhookEvents)
    .values({ id: eventId, type: eventType, payload })
    .onConflictDoNothing({ target: webhookEvents.id })
    .returning({ id: webhookEvents.id })
  if (inserted.length > 0) return true
  const [existing] = await tx
    .select({ processedAt: webhookEvents.processedAt })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, eventId))
    .for('update')
    .limit(1)
  // A row with no `processed_at` is a delivery that failed mid-flight: retry it.
  return !existing?.processedAt
}

const writeSubscription = async (tx: Db, effect: BillingEffect, now: Date): Promise<void> => {
  const row = effect.subscription
  if (!row) return
  await tx
    .insert(subscriptions)
    .values({ ...row, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        userId: row.userId,
        planId: row.planId,
        stripeCustomerId: row.stripeCustomerId,
        status: row.status,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        updatedAt: now,
      },
    })
}

const writeEntitlements = async (tx: Db, effect: BillingEffect): Promise<void> => {
  if (effect.entitlements.length === 0) return
  await tx
    .insert(entitlements)
    .values(effect.entitlements)
    // An admin grant or a promo (`source` ≠ 'subscription') outranks a subscription row: the
    // upsert refuses to shorten it. Everything the subscription itself wrote is replaced.
    .onConflictDoUpdate({
      target: [entitlements.userId, entitlements.feature],
      set: { expiresAt: sql`excluded.expires_at`, source: sql`excluded.source` },
      setWhere: sql`${entitlements.source} = ${ENTITLEMENT_SOURCE}`,
    })
}

const writeReceipt = async (tx: Db, effect: BillingEffect): Promise<void> => {
  const row = effect.receipt
  if (!row) return
  await tx
    .insert(billingReceipts)
    .values(row)
    .onConflictDoUpdate({
      target: billingReceipts.stripeInvoiceId,
      set: {
        status: row.status,
        amountCents: row.amountCents,
        currency: row.currency,
        hostedInvoiceUrl: row.hostedInvoiceUrl,
        invoicePdfUrl: row.invoicePdfUrl,
        description: row.description,
        issuedAt: row.issuedAt,
      },
    })
}

/** One open billing ticket per account: a second dispute updates nothing, it just isn't duplicated. */
const writeTicket = async (tx: Db, effect: BillingEffect): Promise<void> => {
  const ticket = effect.ticket
  if (!ticket) return
  const [open] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.kind, ticket.kind),
        eq(reports.targetType, ticket.targetType),
        eq(reports.targetId, ticket.targetId),
        eq(reports.status, 'open'),
      ),
    )
    .limit(1)
  if (open) return
  await tx.insert(reports).values({
    kind: ticket.kind,
    targetType: ticket.targetType,
    targetId: ticket.targetId,
    reason: ticket.reason,
    detail: ticket.detail,
    payload: ticket.payload,
    status: 'open',
  })
}

/**
 * `subscriptions` + `entitlements` + the receipt, the ticket and the idempotency row, in one
 * transaction. The audit row records the webhook as an actor-less mutation (docs/16).
 */
export const applyBillingEffect = async (input: ApplyInput): Promise<ApplyResult> => {
  const db = await getDb()
  const now = input.now ?? new Date()
  let outcome: ApplyOutcome = 'applied'
  await db.transaction(async (tx) => {
    const claimed = await claimEvent(tx, input.eventId, input.eventType, input.payload)
    if (!claimed) {
      outcome = 'duplicate'
      return
    }
    if (input.defer) {
      outcome = 'deferred'
      return
    }
    const { effect } = input
    await writeSubscription(tx, effect, now)
    await writeEntitlements(tx, effect)
    await writeReceipt(tx, effect)
    await writeTicket(tx, effect)
    await tx
      .update(webhookEvents)
      .set({ processedAt: now })
      .where(eq(webhookEvents.id, input.eventId))
    await tx.insert(auditLog).values({
      actorId: null,
      action: `billing.${input.eventType}`,
      targetType: 'subscription',
      targetId: null,
      before: null,
      after: {
        event_id: input.eventId,
        note: effect.note,
        subscription: effect.subscription
          ? {
              user_id: effect.subscription.userId,
              plan_id: effect.subscription.planId,
              status: effect.subscription.status,
              current_period_end: effect.subscription.currentPeriodEnd.toISOString(),
            }
          : null,
        entitlements: effect.entitlements.map((e) => ({
          user_id: e.userId,
          feature: e.feature,
          expires_at: e.expiresAt.toISOString(),
        })),
        ticket: effect.ticket ? effect.ticket.reason : null,
      },
    })
  })
  return { outcome, note: input.effect.note }
}
