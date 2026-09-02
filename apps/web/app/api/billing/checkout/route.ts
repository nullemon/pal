import { messages } from '@palscans/core/messages'
import { getDb, plans } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { fail, getRateLimiter, ok, parseJson, rateLimited, requireUser } from '@/lib/auth'
import { ensureCustomer, getStripe, isSellable, planFeatures } from '@/lib/billing'
import { getBillingSettings } from '@/lib/billing/config'
import { billingConfigured, getEnv } from '@/lib/env'

/**
 * `POST /api/billing/checkout` — a hosted Stripe Checkout session for one plan (docs/07: the
 * platform never sees card data). Answers 503 with a message when billing is not configured,
 * so the button on /subscribe can say so instead of the route throwing.
 */

const schema = z.object({ planId: z.string().min(1).max(64) })

export const POST = requireUser(async (request, _ctx, user) => {
  if (!billingConfigured())
    return fail(503, 'billing_not_configured', messages.billing.notConfiguredLead)

  const limit = await getRateLimiter().hit(`billing-checkout:${user.id}`, 8, 60)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)

  const parsed = await parseJson(request, schema)
  if (!parsed.ok) return parsed.response

  // docs/07 "Chargebacks": require a verified email before checkout.
  if (!user.emailVerifiedAt) return fail(403, 'email_unverified', messages.billing.verifyFirstHint)

  const db = await getDb()
  const [row] = await db.select().from(plans).where(eq(plans.id, parsed.data.planId)).limit(1)
  if (!row) return fail(404, 'plan_not_found', messages.billing.planUnavailable)
  const plan = { ...row, features: planFeatures(row) }
  if (!isSellable(plan)) return fail(409, 'plan_unavailable', messages.billing.planUnavailable)

  const stripe = await getStripe()
  if (!stripe) return fail(503, 'billing_not_configured', messages.billing.notConfiguredLead)

  const settings = await getBillingSettings(db)
  const site = getEnv().SITE_URL
  try {
    const customer = await ensureCustomer(db, stripe, user)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: String(user.id),
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${site}/me/billing?checkout=success`,
      cancel_url: `${site}/subscribe?checkout=cancelled`,
      allow_promotion_codes: true,
      billing_address_collection: settings.taxEnabled ? 'required' : 'auto',
      // Stripe Tax needs a billable address on the customer, so let Checkout write one back.
      customer_update: { address: 'auto', name: 'auto' },
      automatic_tax: { enabled: settings.taxEnabled },
      tax_id_collection: { enabled: settings.taxEnabled && settings.taxIdCollection },
      subscription_data: {
        metadata: { user_id: String(user.id), plan_id: plan.id },
      },
      metadata: { user_id: String(user.id), plan_id: plan.id },
    })
    if (!session.url) return fail(502, 'checkout_failed', messages.billing.checkoutFailed)
    return ok({ url: session.url, sessionId: session.id })
  } catch (error) {
    console.error('[billing] checkout session failed', error)
    return fail(502, 'checkout_failed', messages.billing.checkoutFailed)
  }
})
