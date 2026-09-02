import { getDb, plans, reports, subscriptions, webhookEvents } from '@palscans/db'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { getBillingSettings } from '@/lib/billing/config'
import { HANDLED_EVENT_TYPES } from '@/lib/billing/events'
import { type BillingPlan, listPlans } from '@/lib/billing/plans'
import type { BillingSettings } from '@/lib/billing/settings'
import { type BillingKeyStatus, billingKeyStatus, getEnv } from '@/lib/env'

/** Server-side data for the billing half of Admin → Business → Premium (agent A). */

export interface WebhookEventRow {
  id: string
  type: string
  receivedAt: Date | null
  processedAt: Date | null
}

export interface SubscriberStats {
  active: number
  trialing: number
  pastDue: number
  canceled: number
  /** Monthly recurring revenue in cents, yearly plans divided by twelve. */
  mrrCents: number
}

export interface BillingAdminData {
  keys: BillingKeyStatus
  settings: BillingSettings
  plans: BillingPlan[]
  events: WebhookEventRow[]
  stats: SubscriberStats
  openTickets: number
  webhookUrl: string
  handledEvents: readonly string[]
}

const statusCounts = async (): Promise<SubscriberStats> => {
  const db = await getDb()
  const rows = await db
    .select({ status: subscriptions.status, n: count() })
    .from(subscriptions)
    .groupBy(subscriptions.status)
  const by = new Map(rows.map((r) => [r.status, Number(r.n)]))
  const [mrr] = await db
    .select({
      cents: sql<string>`coalesce(sum(case when ${plans.interval} = 'year'
        then ${plans.priceCents} / 12.0 else ${plans.priceCents} end), 0)`,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(sql`${subscriptions.status} in ('active', 'trialing')`)
  return {
    active: by.get('active') ?? 0,
    trialing: by.get('trialing') ?? 0,
    pastDue: by.get('past_due') ?? 0,
    canceled: by.get('canceled') ?? 0,
    mrrCents: Math.round(Number(mrr?.cents ?? 0)),
  }
}

export const loadBillingAdmin = async (): Promise<BillingAdminData> => {
  const db = await getDb()
  // `webhook_events` keeps no received-at column of its own; Stripe stamps the payload.
  const receivedAt = sql<
    string | null
  >`to_timestamp((${webhookEvents.payload}->>'created')::bigint)`
  const [settings, planRows, events, stats, tickets] = await Promise.all([
    getBillingSettings(db),
    listPlans(db),
    db
      .select({
        id: webhookEvents.id,
        type: webhookEvents.type,
        processedAt: webhookEvents.processedAt,
        receivedAt,
      })
      .from(webhookEvents)
      .orderBy(desc(sql`coalesce((${webhookEvents.payload}->>'created')::bigint, 0)`))
      .limit(10),
    statusCounts(),
    db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.kind, 'billing'), eq(reports.status, 'open'))),
  ])
  return {
    keys: billingKeyStatus(),
    settings,
    plans: planRows,
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      processedAt: e.processedAt,
      receivedAt: e.receivedAt ? new Date(e.receivedAt) : null,
    })),
    stats,
    openTickets: Number(tickets[0]?.n ?? 0),
    webhookUrl: `${getEnv().SITE_URL}/api/webhooks/stripe`,
    handledEvents: HANDLED_EVENT_TYPES,
  }
}
