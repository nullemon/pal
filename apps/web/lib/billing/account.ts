import { billingReceipts, type Db, plans, reports, subscriptions } from '@palscans/db'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { findCustomerId } from './stripe'

/** Everything `/me/billing` shows about one account. One query set, no Stripe API call. */

export interface AccountSubscription {
  planId: string
  planName: string
  priceCents: number
  interval: string
  status: string
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
}

export interface AccountReceipt {
  id: number
  stripeInvoiceId: string
  description: string | null
  amountCents: number
  currency: string
  status: string
  hostedInvoiceUrl: string | null
  invoicePdfUrl: string | null
  issuedAt: Date
}

export interface AccountBilling {
  subscription: AccountSubscription | null
  receipts: AccountReceipt[]
  /** A Stripe customer exists, so the Customer Portal has something to open. */
  hasCustomer: boolean
  /** An open billing ticket (a dispute suspends perks and opens one — docs/07). */
  hasOpenTicket: boolean
}

/** Statuses that still describe a live relationship, newest first when several exist. */
const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'paused']

export const accountBilling = async (db: Db, userId: number): Promise<AccountBilling> => {
  const [live, latest, receipts, tickets, customerId] = await Promise.all([
    db
      .select({
        planId: subscriptions.planId,
        planName: plans.name,
        priceCents: plans.priceCents,
        interval: plans.interval,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, LIVE_STATUSES)))
      .orderBy(desc(subscriptions.currentPeriodEnd))
      .limit(1),
    db
      .select({
        planId: subscriptions.planId,
        planName: plans.name,
        priceCents: plans.priceCents,
        interval: plans.interval,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.updatedAt))
      .limit(1),
    db
      .select({
        id: billingReceipts.id,
        stripeInvoiceId: billingReceipts.stripeInvoiceId,
        description: billingReceipts.description,
        amountCents: billingReceipts.amountCents,
        currency: billingReceipts.currency,
        status: billingReceipts.status,
        hostedInvoiceUrl: billingReceipts.hostedInvoiceUrl,
        invoicePdfUrl: billingReceipts.invoicePdfUrl,
        issuedAt: billingReceipts.issuedAt,
      })
      .from(billingReceipts)
      .where(eq(billingReceipts.userId, userId))
      .orderBy(desc(billingReceipts.issuedAt))
      .limit(12),
    db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.kind, 'billing'),
          eq(reports.targetType, 'user'),
          eq(reports.targetId, userId),
          eq(reports.status, 'open'),
        ),
      )
      .limit(1),
    findCustomerId(db, userId),
  ])
  return {
    // A cancelled subscription still belongs on the page until its period ends.
    subscription: live[0] ?? latest[0] ?? null,
    receipts,
    hasCustomer: !!customerId,
    hasOpenTicket: tickets.length > 0,
  }
}
