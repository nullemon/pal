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

**The same property is a trap during a restore.** Bring a dump up on a host whose
`CREDENTIALS_KEY` differs by one character and nothing fails loudly: every row is silently
"absent", every integration falls back to an empty environment, `/api/health` still answers
`ok`, and the panel still shows the green *Sealed with `CREDENTIALS_KEY`* banner — it reports
where the key came from, not whether it opens anything. Storage, mail, OAuth, Stripe,
Turnstile, push and Discord are all off, and the site looks fine. The tell is that every field
on Integrations reads source **env** or **unset** while `select count(*) from app_credentials`
is non-zero. So the key belongs in your password manager next to the R2 keys, not only in
`.env` on a server that may not exist tomorrow — `infra/RUNBOOK.md` makes restoring it step 0
of any restore.

### One thing sealed with this key is *not* a credential

`users.totp_secret_sealed` (migration 9036). The enrolled second factor used to sit in
`users.totp_secret` as raw base32, so a dump handed over working second factors for every
enrolled account, staff included — the same threat this table was sealed against, one table
over. It is sealed with the same key now.

It does **not** behave like a credential row, and the difference matters:

- **There is no environment fallback**, because there is nowhere for a TOTP secret to fall
  back to. A secret that will not open reads as "no secret", the code check fails, and the
  account cannot complete sign-in. That is the correct direction — the alternative is a
  second factor that turns itself off when the key moves — but it means **rotating the
  sealing key locks out every enrolled account**, where for credentials it only makes them
  re-enter values. It is not silent: those users see their codes rejected.
- **The way back is Admin → Users → Clear two-factor**, which drops the factor and ends the
  account's sessions so they can sign in with their password and enrol again. Since an
  `admin` cannot reach the panel without a second factor, keep one admin's recovery in mind
  before rotating: if every admin is locked out at once, the only door left is
  `update users set totp_secret_sealed = null, totp_enabled_at = null where id = …` against
  the database.
- **Rows enrolled before 9036 are not migrated by the migration** — it cannot encrypt
  anything, the key is not in the database. They keep working from the plaintext column and
  re-seal themselves the next time that account passes its second factor, so the column
  empties as people sign in. Nothing writes plaintext any more.

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
any async path that touches configuration keeps it current, and the async loaders that build
storage URLs `await ensureConfig()` first.

## Why installation happens in `lib/config/install.ts`, not `instrumentation.ts`

`instrumentation.ts` is the obvious home for "install a resolver once per process", and it
does not work. Next bundles instrumentation in a separate module graph, so the module-level
state written there — the storage resolver inside `@palscans/core/storage`, the mirror in
`lib/config/mirror.ts` — is invisible to request handlers.

This was measured, not reasoned about. With the resolver installed only from instrumentation,
a request reported `driver: "fs"` while the panel held `s3`, and the homepage rendered image
URLs from the environment's CDN while the store resolved the panel's. The failure is silent:
nothing errors, uploads simply go to the wrong bucket.

So installation is an import side effect of `lib/config/install.ts`, and the modules that need
it import it — putting it in the same graph as the code that reads it. `@/lib/storage` pulls
it in, which is why **application code must import `getStorage` from `@/lib/storage`, never
from `@palscans/core/storage` directly**. `lib/config/install.test.ts` walks the source and
fails if anything bypasses that, because no runtime test could catch it.

## Storage is rebuilt, not restarted

`getStorage()` in `@palscans/core` takes an injected resolver rather than reading the
environment directly — injected, because that package must not depend on the database, and
the web app and the worker each supply their own reader.

The resolver returns a `fingerprint` alongside the options. When it changes, the S3 client is
rebuilt. That is what makes a new R2 key take effect on the next request instead of the next
deploy. The fingerprint includes the secret only by length and last four characters, so it
can be compared and logged without ever carrying the key.

## What is stale, and for how long

The store is memoised **in process** for 30 seconds (`CACHE_TTL_MS` in
`apps/web/lib/config/store.ts`, `CREDENTIAL_TTL_MS` in `apps/worker/src/lib/config.ts` — the
same number in both). A save calls `purgeConfigCache()` and so takes effect immediately in the
process that handled it. Other processes — a second web instance, the worker — pick the change
up within that 30-second window.

Note "in process": there is no cache tag to purge and nothing crosses process boundaries. The
TTL *is* the invalidation mechanism, which is why it is short. (The original implementation
used `unstable_cache`, which was both cross-process and a security hole — see below.)

For credentials this is the right trade: they change rarely, and the alternative is a database
read on every request that needs one. It does mean "I changed the R2 key and the worker is
still using the old one" is expected for up to 30 seconds, not a bug. Restart the worker if
you need it immediately.

## What an adversarial review found

The design above was reviewed as an attacker would, after it was built. Five things were
wrong, four of them security-relevant. They are fixed; recording them here because each one
was invisible to the test suite and would come back the same way.

**Decrypted credentials were written to disk in plaintext.** The store cached the unsealed map
in Next's `unstable_cache`, which persists results under `.next/cache/fetch-cache/` as JSON —
in production, not just dev. Verified by storing a canary and finding it in the cache file.
Anything that could read the filesystem, a container layer, a mounted cache volume or a CI
artifact had every credential in the clear, and a stale entry outlived the credential's
deletion. Sealing them in the database achieved nothing against the most likely attacker. The
store now uses an in-process TTL memo, the same shape the worker already used, and nothing
decrypted reaches Next's cache.

**A stored secret could be sent to a host of the caller's choosing.** The connection test
substitutes the stored value when a secret comes back masked, but took the *destination* from
the same request. Submitting a new `smtp_host` while leaving the password masked made the
server open a session to that host and send `AUTH PLAIN` with the stored password. The browser
never sees a secret, but it chose where one went. A secret is now bound to its destination:
change the host or endpoint and it must be typed again.

**The hand-written SMTP client could have commands injected into it.** `bareAddress` matched
`[^>]+`, which includes CR and LF, and the result went unescaped into `MAIL FROM:` and
`RCPT TO:`. A stored `From` of `a@b\r\nRCPT TO:<evil@x>` added a silent recipient to every
verification and password-reset mail — a persistent interception of reset links that would
survive the setter losing their account. Line and bracket characters are now stripped.

**Rotation failed open for bot protection.** `verifyTurnstile` passes every request when no
secret is configured, and an unreadable row (rotated sealing key) was indistinguishable from
an unconfigured one — so the rotation this document calls safe would have silently switched
Turnstile off. `readSealedCredentialsDetailed` now reports unreadable rows separately, and
Turnstile fails closed on one. The storage driver had the same shape with a different cost:
it would have quietly downgraded to the local-disk driver and written production uploads into
the container, so it now stays on S3 and fails loudly instead.

**The connection tests were an SSRF primitive.** Only an admin with TOTP can reach them, and
CSRF cannot (Origin check, `SameSite=Lax`, and the response is unreadable cross-origin) — but
that is a thin margin in front of the cloud metadata endpoint, and the SMTP test reflects a
couple of hundred characters of whatever answers. Hosts are now resolved and internal targets
refused, with loopback allowed for SMTP only because the shipped compose stack runs Mailpit
there.

Two smaller things were accepted rather than changed: ciphertexts are not bound to their row
key (an attacker with database write access but no key could swap sealed blobs between fields
or delete rows to force the environment fallback), and `s3.access_key_id` is treated as an
identifier rather than a secret, so the panel echoes it.

## Rules the code holds to

- A secret is never sent to the browser. The panel receives a mask, and submitting the mask
  unchanged leaves the stored value alone — the browser cannot round-trip a value it was
  never given.
- A secret never reaches an audit row. Saving records *which* field ids changed, nothing more.
- A secret never reaches a log line, including the storage fingerprint.
- A connection test reports what it actually verified. A field that cannot be checked without
  a live transaction says so rather than showing a green tick.
