import { messages } from '@palscans/core/messages'
import { getDb } from '@palscans/db'
import { fail, getRateLimiter, ok, rateLimited, requireUser } from '@/lib/auth'
import { billingConfigured, findCustomerId, getStripe } from '@/lib/billing'
import { getBillingSettings } from '@/lib/billing/config'
import { getEnv } from '@/lib/env'

/**
 * `POST /api/billing/portal` — Stripe's Customer Portal (docs/07: cancel, plan change and card
 * update are Stripe's screens, not code we write). 503 with a message when billing is off.
 */
export const POST = requireUser(async (_request, _ctx, user) => {
  if (!(await billingConfigured()))
    return fail(503, 'billing_not_configured', messages.billing.notConfiguredLead)

  const limit = await getRateLimiter().hit(`billing-portal:${user.id}`, 8, 60)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)

  const db = await getDb()
  const settings = await getBillingSettings(db)
  if (!settings.portalEnabled) return fail(503, 'portal_disabled', messages.billing.portalFailed)

  const customerId = await findCustomerId(db, user.id)
  if (!customerId) return fail(404, 'no_customer', messages.billing.portalFailed)

  const stripe = await getStripe()
  if (!stripe) return fail(503, 'billing_not_configured', messages.billing.notConfiguredLead)

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getEnv().SITE_URL}/me/billing`,
    })
    return ok({ url: session.url })
  } catch (error) {
    console.error('[billing] portal session failed', error)
    return fail(502, 'portal_failed', messages.billing.portalFailed)
  }
})
