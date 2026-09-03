# Credentials in the admin panel

Integration credentials — Cloudflare R2 keys, SMTP, OAuth, Stripe, Turnstile, VAPID, the
Discord bot token — are entered in **Admin → System → Integrations** and stored in the
database, not in `.env` on the server. This document is why it is built the way it is, and
where the edges are.

## The bootstrap boundary

Five values cannot move into the panel, and it is worth being precise about why rather than
treating it as an arbitrary list:

| Value | Why it must stay in the environment |
| --- | --- |
| `DATABASE_URL` | The panel's settings live in the database. It cannot hold its own connection string. |
| `SESSION_SECRET` | It validates the session that authenticates you *to* the panel. |
| `SITE_URL` | Read while issuing cookies, before any request is authenticated. |
| `TRUSTED_PROXY` | Read on every request to derive the client IP, before auth. Security-critical: someone who could set it from inside the app could forge their own address. |
| `REDIS_URL` | The queue connects at process start. |

Everything else is in `apps/web/lib/config/registry.ts`, which is the single declaration the
admin screen renders from, the store validates against, and the resolvers read through. Add
a field there and it appears in the panel; there is no second list to keep in sync.

## Precedence: panel over environment

A value typed into the panel wins. Clearing a field deletes the row and the environment
variable takes over again. That ordering is deliberate — it means an existing `.env`
deployment keeps working untouched, and values can be moved into the panel one at a time
rather than in a big-bang migration.

The panel shows the **source** of every field (`panel`, `env`, `unset`) for exactly this
reason: without it, "the key is set" is ambiguous about which copy is actually in use.

## Sealing

Values are encrypted with AES-256-GCM before they are stored (`packages/core/src/secrets.ts`).
The reason is narrow and worth stating: credentials now live in Postgres, and a database dump
is the thing most likely to leave the server. Sealing means a dump does not hand over the
bucket.

The key is derived by HKDF from `CREDENTIALS_KEY`, falling back to `SESSION_SECRET` so an
existing deployment needs no new variable.

**That fallback has a consequence.** Rotating `SESSION_SECRET` without setting
`CREDENTIALS_KEY` first makes every stored credential unreadable, and they must be re-entered.
The panel says which key is in use so this is visible before it bites. Set `CREDENTIALS_KEY`
to a separate value if you expect to rotate sessions.

A row that will not decrypt is treated as **absent**, not as an error: the environment
fallback takes over. A rotated key therefore degrades to the previous behaviour instead of
taking the site down.

## Two values need to be readable synchronously

Nearly every credential is consumed from an async path, so those read the store directly.
Two are not: the storage driver and the public CDN hostname are read while building image
URLs inside plain synchronous functions (`lib/seo/urls.ts`, `components/discovery/media.ts`,
the reader's page data, comment media, upload URLs).

Making those async would ripple through most of the render tree. Worse, the obvious
alternative — refreshing in the root layout — would break something load-bearing: that layout
is deliberately synchronous so `/` and the series pages stay prerendered, and a database read
there turns every route dynamic.

So `lib/config/mirror.ts` holds those two values in a dependency-free module (no database, no
`server-only`, safe to import anywhere), seeded from the environment at import so the site
renders correctly before the first database read. `resolveConfig()` writes through to it, so
any async path that touches configuration keeps it current, and `instrumentation.ts` seeds it
at process start.

## Storage is rebuilt, not restarted

`getStorage()` in `@palscans/core` takes an injected resolver rather than reading the
environment directly — injected, because that package must not depend on the database, and
the web app and the worker each supply their own reader.

The resolver returns a `fingerprint` alongside the options. When it changes, the S3 client is
rebuilt. That is what makes a new R2 key take effect on the next request instead of the next
deploy. The fingerprint includes the secret only by length and last four characters, so it
can be compared and logged without ever carrying the key.

## What is stale, and for how long

The store is cached for 300 seconds and tagged, so a save purges it immediately **in the
process that handled the save**. Other processes — a second web instance, the worker — pick
the change up within that 300-second window.

For credentials this is the right trade: they change rarely, and the alternative is a database
read on every request that needs one. It does mean "I changed the R2 key and the worker is
still using the old one" is expected for up to five minutes, not a bug. Restart the worker if
you need it immediately.

## Rules the code holds to

- A secret is never sent to the browser. The panel receives a mask, and submitting the mask
  unchanged leaves the stored value alone — the browser cannot round-trip a value it was
  never given.
- A secret never reaches an audit row. Saving records *which* field ids changed, nothing more.
- A secret never reaches a log line, including the storage fingerprint.
- A connection test reports what it actually verified. A field that cannot be checked without
  a live transaction says so rather than showing a green tick.
