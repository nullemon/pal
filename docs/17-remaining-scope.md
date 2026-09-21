# 17 — Remaining scope

What is still to build after the platform's first pass. Every item here is additive: the
schema, admin shell, permission layer, storage, queue and design system already exist and
must be reused, not re-created. Read `16-build-plan.md` first — its conventions bind.

## A · Billing (Stripe)

Nothing is wired today: `/subscribe` shows the plans and the locked-chapter gate points at
it, but there is no checkout. Build per `07-auth-and-monetization.md`:

- Stripe Checkout for the two plans, Customer Portal for cancel/plan-change/card-update.
- Webhooks: `checkout.session.completed`, `customer.subscription.updated|deleted`,
  `invoice.payment_failed`, `charge.dispute.created`. Idempotent on the Stripe event id via
  `webhook_events`; each writes `subscriptions` **and** the derived `entitlements` rows in
  one transaction.
- Grace: `past_due` keeps entitlements for 3 days; `canceled` expires at
  `current_period_end`, never immediately.
- Stripe Tax on; receipts linked from `/me/billing`; a recognisable statement descriptor.
- Disputes suspend entitlements and open a billing ticket rather than deleting the account.
- **Everything is inert without keys.** With `STRIPE_SECRET_KEY` unset the plans render with
  a "billing not configured" state, no route 500s, and the admin Premium screen says so.

## B · Entitlements the operator controls

The point: **any premium feature can be made free for everyone**, without code.

- `Admin → Business → Premium`: one row per feature (`early_access`, `premium_content`,
  `offline`, `no_ads`, `priority_comments`, `see_reactors`, `custom_gifs`, `animated_avatar`,
  `profile_banner`) with a three-way control — **Premium only · Free for everyone ·
  Disabled**. Stored in `settings.entitlements`.
- `entitlement(user, feature)` in `@palscans/core` consults the override first: `free`
  returns true for everyone including signed-out readers where that makes sense; `disabled`
  returns false for everyone including staff; `premium` keeps today's behaviour.
- A global **"All premium features free"** master switch, and a scheduled window
  (`free_until`) so a promotion ends by itself.
- Admin grants stay: per-user entitlement with an expiry, from the user detail screen.
- The subscribe page and every gate reflect the override live (a feature that is free shows
  as free, not as a locked upsell).

## C · Accounts and access, operator-controlled

`settings.site.registration` (open · invite · closed) exists. Complete the surface:

- Registration: email-domain allow/block list, require-verification toggle, minimum account
  age before commenting (exists in comment settings — surface it here too), Turnstile on/off,
  invite codes (generate, list, revoke, single- or multi-use, expiry) when mode is `invite`.
- ~~**Login history**~~ — **built, then removed.** The `login_events` table recorded every
  sign-in attempt with the country and city from `CF-IPCountry`/`CF-IPCity`, shown in
  `Admin → Users → detail`, on `/me/security`, and as a failed-login spike tile on the
  dashboard. Migration 9038 dropped all of it at the operator's instruction: "where users
  logged in from" is also *where staff logged in from*, and any account holding `user.read`
  could read another admin's city off that screen. What survives is the active-session list
  with revoke (device and last-seen, no place), which covers the "someone else is in my
  account" case the history was mostly used for. See docs/02 "Privacy".
- Bulk user actions from the list: role change, ban, comment-ban, force logout, export.
- `Admin → Users → new`: create an account manually (role, verified, entitlements).

## D · Notifications

- **Web push**: VAPID keys in env, service worker subscription, `push_subscriptions` rows,
  per-kind preferences, sending from the worker on `chapter.published`. Silent no-op when
  keys are unset.
- **Email digest**: daily or weekly "new chapters for you", opt-in, rendered from the same
  templates, sent by the worker; a preview in admin.
- **Discord**: channel webhooks posting new-chapter embeds (admin-configured URL, test
  button); per-user account linking with a generated code, role sync by tier, DMs for
  bookmarked series. Inert without a bot token.
- `Admin → Community → Notifications`: what fires, to whom, with a send-test control.

## E · Legacy site importer

Per `09-legacy-site-migration.md`, as a real, resumable job:

- Source config in admin (database DSN or an uploaded SQL dump, uploads path or an archive).
- Discovery step that reports what it found before writing anything (counts per post type,
  taxonomy, meta key) against the confirmed mapping.
- Dry run producing the mapping report and the unparsed-chapter CSV.
- Import in batches, idempotent on `manga_unique_id`, resumable, with progress in the jobs
  view; images fed straight into the existing `chapter.process` pipeline.
- Password rows imported null with a one-time set-password mail at cutover.
- Redirect rows generated for every legacy URL into the existing `redirects` table.

## F · Alternate layouts

Home and series currently ship layout **A** and **B**. Build **C Editorial Noir**,
**D Catalog Grid**, **E Daylight** and **F Cinematic Rows** from
`design/mockups/{C,D,E,F}/` as selectable implementations behind the existing
`Appearance → Layouts` switcher, sharing the same data helpers and components. Each must
pass the same performance budgets and render correctly in both themes.

## G · Polish carried over

- Offline chapter downloads (PWA) behind the `offline` entitlement.
- Reading stats on the profile; custom reading lists.
- `Admin → System → Backup now` (database dump to storage) and the restore runbook check.
- A `/status` link and the uptime page.
