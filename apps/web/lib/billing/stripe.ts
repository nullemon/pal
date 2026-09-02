import type { SessionUser } from '@palscans/core'
import { billingCustomers, type Db, subscriptions } from '@palscans/db'
import { desc, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { billingKeyStatus, getEnv } from '../env'

/**
 * The Stripe client, created lazily and only when a secret key exists (docs/17 §A: the whole
 * feature is inert without keys). Import the SDK dynamically so a deployment with billing off
 * never loads it, and so unit tests can import the reducer without pulling in the package.
 */

let client: Stripe | null = null
let clientKey: string | null = null

export const getStripe = async (): Promise<Stripe | null> => {
  const key = getEnv().STRIPE_SECRET_KEY
  if (!key) return null
  if (client && clientKey === key) return client
  const { default: StripeCtor } = await import('stripe')
  client = new StripeCtor(key, {
    // Pinning nothing keeps the SDK on the version it was built against; webhook payloads are
    // parsed by zod (./events.ts) so an account on an older version still works.
    appInfo: { name: 'PALScans', url: getEnv().SITE_URL },
    maxNetworkRetries: 2,
    timeout: 20_000,
  })
  clientKey = key
  return client
}

/** Tests: swap or clear the shared client. */
export const setStripe = (next: Stripe | null): void => {
  client = next
  clientKey = next ? (getEnv().STRIPE_SECRET_KEY ?? null) : null
}

export const billingStatus = () => billingKeyStatus()

/** The Stripe customer for an account, from `billing_customers` first, then any subscription. */
export const findCustomerId = async (db: Db, userId: number): Promise<string | null> => {
  const [linked] = await db
    .select({ id: billingCustomers.stripeCustomerId })
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, userId))
    .limit(1)
  if (linked) return linked.id
  const [sub] = await db
    .select({ id: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1)
  return sub?.id ?? null
}

export const findUserIdByCustomer = async (db: Db, customerId: string): Promise<number | null> => {
  const [linked] = await db
    .select({ userId: billingCustomers.userId })
    .from(billingCustomers)
    .where(eq(billingCustomers.stripeCustomerId, customerId))
    .limit(1)
  if (linked) return linked.userId
  const [sub] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1)
  return sub?.userId ?? null
}

export const linkCustomer = async (
  db: Db,
  userId: number,
  stripeCustomerId: string,
): Promise<void> => {
  const now = new Date()
  await db
    .insert(billingCustomers)
    .values({ userId, stripeCustomerId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: billingCustomers.userId,
      set: { stripeCustomerId, updatedAt: now },
    })
}

/**
 * The customer id to charge: reuse the linked one, otherwise create it *before* Checkout so a
 * webhook can always resolve the account from `customer` alone, even if the reader closes the
 * tab mid-payment.
 */
export const ensureCustomer = async (
  db: Db,
  stripe: Stripe,
  user: SessionUser,
): Promise<string> => {
  const existing = await findCustomerId(db, user.id)
  if (existing) return existing
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.username ?? undefined,
    metadata: { user_id: String(user.id), username: user.username ?? '' },
  })
  await linkCustomer(db, user.id, customer.id)
  return customer.id
}
