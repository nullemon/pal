import { messages } from '@palscans/core/messages'
import { fail, ok, readBody } from '@/lib/auth'
import { billingConfigured, getStripe, handleStripeEvent, stripeWebhookSecret } from '@/lib/billing'

/**
 * `POST /api/webhooks/stripe` — the only route that grants a paid entitlement.
 *
 * The signature is verified against the **raw** body before anything is parsed (docs/07), the
 * event id makes the write idempotent (`webhook_events`), and everything the event implies is
 * written in one transaction. Cross-site by definition, so no CSRF check applies: the
 * signature is the authentication.
 */

/** Stripe events are small; a body past this never reaches the verifier. */
const MAX_EVENT_BYTES = 512 * 1024

export const POST = async (request: Request): Promise<Response> => {
  if (!(await billingConfigured()))
    return fail(503, 'billing_not_configured', messages.billing.notConfiguredLead)

  const signature = request.headers.get('stripe-signature')
  if (!signature) return fail(400, 'missing_signature')

  const read = await readBody(request, MAX_EVENT_BYTES)
  if (!read.ok) return read.response
  const raw = new TextDecoder().decode(read.body)

  const stripe = await getStripe()
  const secret = await stripeWebhookSecret()
  if (!stripe || !secret)
    return fail(503, 'billing_not_configured', messages.billing.notConfiguredLead)

  let event: unknown
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret)
  } catch {
    return fail(400, 'invalid_signature')
  }

  try {
    const result = await handleStripeEvent(event)
    return ok({ received: true, outcome: result.outcome, type: result.type })
  } catch (error) {
    // A 500 makes Stripe retry, which is what we want: the event row is only marked processed
    // inside the transaction that wrote its rows, so a retry is safe.
    console.error('[billing] webhook failed', error)
    return fail(500, 'webhook_failed')
  }
}
