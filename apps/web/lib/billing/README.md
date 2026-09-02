# `@/lib/billing`

Stripe Checkout, the Customer Portal and the webhook that grants entitlements
(docs/07-auth-and-monetization.md, docs/17 §A). Authorization is still `@palscans/core`; this
module only decides *what a payment implies*.

```ts
import { billingConfigured } from '@/lib/env'      // the one switch
import { listPlans, accountBilling } from '@/lib/billing'
```

## Inert without keys

`billingConfigured()` is true only when **both** `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` are set (`billingKeyStatus()` reports each one for the admin screen).
With either missing: `/subscribe` and `/me/billing` render a "billing is not set up yet"
state, Admin → Premium says which key is missing, and every route answers
`503 { error: 'billing_not_configured' }` — nothing throws, nothing is charged, no test or
build ever reaches the network.

| Module | What it is |
|---|---|
| `events.ts` | Stripe payloads → snapshots, parsed with zod straight from the JSON (never the SDK's types) so a replay on an older API version still works. `actionFor(type)` maps the eight handled event names onto five actions. |
| `reducer.ts` | **The rules.** `reduceBillingEvent(input) → BillingEffect`: pure, clock-injected, no database. `entitlementExpiry(status, periodEnd, now, graceDays)` is the single expression of "who keeps access". Unit-tested from fixture payloads in `__fixtures__/`. |
| `apply.ts` | Writes an effect: `subscriptions` + `entitlements` + receipt + ticket + `webhook_events` + `audit_log`, in **one transaction**, idempotent on the Stripe event id (the row is claimed with `INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`, so concurrent deliveries serialise). |
| `webhook.ts` | Resolves the account and the plan (the only steps needing the database or Stripe), then reduce → apply → email. An event whose account or plan is unknown is stored **unprocessed** and shows as "pending" in Admin → Premium. |
| `stripe.ts` | Lazy SDK client (`getStripe()` → `null` without a key), `billing_customers` lookups, `ensureCustomer` (written *before* Checkout so a webhook can always find the account). |
| `plans.ts` / `settings.ts` / `config.ts` | `plans` rows incl. `features` and `active`; `settings.billing` (grace days, Stripe Tax, portal, statement descriptor, help link). `settings.ts` is dependency-free so the admin panel validates the same schema. |
| `account.ts` | Everything `/me/billing` shows: plan, receipts, whether a portal session is possible, whether a billing ticket is open. |
| `notify.ts` | The four billing emails through `@/lib/email`; best-effort, never fails a webhook. |

## The rules the reducer encodes (docs/07)

- `active` / `trialing` → entitlements until `current_period_end`.
- `past_due` → `max(current_period_end, now + graceDays)`; the default grace is **3 days** and
  a failed payment never *shortens* what the reader already paid for.
- `canceled` (incl. `customer.subscription.deleted`) → expires **at the period end**, never
  immediately. `incomplete` / `incomplete_expired` → grants nothing.
- A downgrade expires the features the new plan no longer covers, with the same event.
- `charge.dispute.created` → every subscription-sourced entitlement is suspended (expiry =
  now) and a `reports` row with `kind = 'billing'` is opened. The account is never deleted.
- Entitlement rows are upserted with `setWhere: source = 'subscription'`, so an admin grant or
  a promo always outranks a subscription row and is never shortened by a webhook.

## Endpoints

`POST /api/billing/checkout` (`{ planId }` → `{ url }`; requires a verified email, refuses a
placeholder `price_dev_*` price) · `POST /api/billing/portal` (→ `{ url }`) ·
`POST /api/webhooks/stripe` (raw body, `constructEventAsync` signature check; no CSRF check —
the signature is the authentication).

Register the endpoint in Stripe for: `checkout.session.completed`,
`customer.subscription.created|updated|deleted`, `invoice.payment_failed`, `invoice.paid`,
`invoice.payment_succeeded`, `charge.dispute.created`.
