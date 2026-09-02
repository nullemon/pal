# 07 — Auth, roles, and monetization

## Sessions

**Opaque server-side sessions in an HttpOnly cookie.** Not JWTs in `localStorage`.

```
Cookie: sid=<session-uuid>.<base64url(32 random bytes)>
        HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
```

The database stores the session id and `sha256(secret)`. On each request the middleware
splits the cookie, looks up the row by id (Redis first, Postgres on miss), and constant-time
compares the hash. A database dump does not yield usable sessions.

Why this rather than Asura's model — tokens duplicated into `localStorage` *and* non-HttpOnly
cookies:

- A single XSS anywhere on the origin — including one that slips through comment rendering —
  reads `localStorage` and exfiltrates a 30-day refresh token. HttpOnly cookies are not
  readable by script, so the same XSS is limited to acting *as* the user while the page is
  open, which is a far smaller blast radius.
- Revocation is instant: delete the row. A stateless JWT stays valid until it expires, so
  "log out everywhere" is a lie unless you keep a denylist — at which point you have server
  state anyway, without the benefits.
- No token refresh dance, no clock skew, no two storage locations to keep in sync.

`SameSite=Lax` covers CSRF for navigations; mutating routes additionally require either a
double-submit CSRF token or an `Origin` header check. Sessions rotate their secret on
privilege escalation (login, password change, role change).

Cost: a Redis lookup per request. At the scale being designed for, that is roughly 0.3ms.

**Password hashing:** Argon2id, `m=19456, t=2, p=1` (the OWASP baseline), rehashed on login
when parameters change. Never bcrypt on new code, never a fast hash.

**Rate limits**, per IP and per account, in Redis: login 5/min then exponential backoff;
register 3/hour/IP; forgot-password 3/hour/email with an identical response whether or not
the address exists; page-manifest fetches 60/min.

**Email verification** is required before commenting or subscribing — not before reading.
Gating reading on verification loses users; gating spend on it prevents most fraud.

**OAuth:** Google first, Discord second (this audience lives on Discord, and it doubles as
the notification channel). Standard authorization-code flow with PKCE and a `state` nonce.
On first OAuth login with an email that already has a password account, **link** the accounts
after re-authentication — never silently merge, which is an account-takeover primitive.

**Account security page:** active sessions with device, approximate location, last-seen, and
individual revoke; "sign out everywhere"; password change requiring the current password;
optional TOTP 2FA for staff roles (mandatory for `admin`).

## Roles versus entitlements

Two orthogonal axes, which Asura conflates:

- **Role** — what you may *do*. `user | supporter | premium | uploader | moderator | admin`.
  Drives the admin panel. See `04-admin-panel.md`.
- **Entitlement** — what you may *access*. Rows in `entitlements`, each with an optional
  expiry, written by Stripe webhooks, admin grants, and promo redemptions.

```ts
export async function entitlement(user, feature) {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'moderator') return true   // staff bypass, once
  const row = await getEntitlement(user.id, feature)
  return !!row && (row.expires_at === null || row.expires_at > new Date())
}

export async function canReadChapter(user, chapter) {
  if (chapter.state !== 'published') return can(user, 'chapter.read')
  if (chapter.early_access_until && chapter.early_access_until > new Date())
    return entitlement(user, 'early_access')
  if (chapter.is_premium) return entitlement(user, 'premium_content')
  return true
}
```

This function exists **once**. The route handler calls it, the page-manifest endpoint calls
it, the download endpoint calls it. Asura's equivalent logic is written three times in three
inline scripts, one of which carries a comment conceding the copies must be kept in step.

## Subscriptions

Two tiers is the right number. Three makes people compare instead of buy.

| | **Supporter** ~$2/mo | **Premium** ~$5/mo |
|---|---|---|
| Ad-free | ✓ | ✓ |
| Early access | — | ✓ (typically 24–72h) |
| Offline download | — | ✓ |
| Unlimited bookmarks | ✓ | ✓ |
| Profile badge / animated avatar | badge | both |
| Priority comments, see who reacted | — | ✓ |
| Private Discord role | — | ✓ |

Flow: Stripe Checkout (hosted — do not handle card data), webhook on
`checkout.session.completed`, `customer.subscription.updated|deleted`,
`invoice.payment_failed`. Each webhook is idempotent on the Stripe event id via
`webhook_events`, and each writes `subscriptions` **and** the derived `entitlements` rows in
one transaction. Stripe's Customer Portal handles cancel, plan change, and card update, so
none of that is code you write.

Grace: on `past_due`, keep entitlements alive for 3 days and email. On `canceled`,
entitlements expire at `current_period_end`, not immediately — people paid for the month.

**Chargebacks.** Asura has visible scarring here (a chargeback banner and a billing dispute
ticketing system). Mitigations that actually work: require a verified email before checkout;
enable Stripe Radar; put a recognisable descriptor on the statement (the site name, not a
company name nobody recognises); email a receipt with a one-click cancel link; and surface
an in-app billing support ticket flow so the frustrated path leads to you rather than to the
bank. On a dispute, suspend entitlements and open a ticket rather than deleting the account —
a meaningful share of disputes are a family member's card, not fraud.

**Consumable currency.** Asura sells "shards" for individual locked chapters. Skip it at
launch. It doubles the billing surface, brings VAT complications on prepaid balances in
several jurisdictions, and only pays off once you have a large catalog. Design the schema so
it can be added (`entitlements` is already per-feature; a `wallets` + `unlocks` pair drops in
cleanly) but do not build it in v1.

## Content compliance

The platform hosts uploaded material, so takedown handling is a feature with a UI, an SLA,
and an audit trail — not an inbox someone checks.

- A `/dmca` page with the designated agent's details and a structured notice form that
  writes a `reports` row with `kind = 'dmca'`.
- The admin reports queue treats DMCA notices as a distinct lane with a visible clock.
- One action, `series.takedown`, does the whole thing atomically: sets `state = 'removed'`,
  hides the series from every feed and from search, purges CDN paths, writes `takedowns` and
  `audit_log` rows, and emails the claimant an acknowledgement.
- `geo_restrictions` allows blocking a title in the territories where a licence exists
  instead of removing it globally — often the outcome a rights holder actually wants.
- Counter-notice handling and a repeat-infringer policy, which `chapters.uploaded_by` makes
  enforceable.
- Registering a DMCA agent with the US Copyright Office (~$6) is what makes safe-harbour
  available at all. It is the cheapest insurance in this entire budget.
