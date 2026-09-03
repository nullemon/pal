# Launch

How to take this repository from "builds green" to "palscans.org is serving readers".

Nothing is deployed anywhere yet. The application is finished and verified; the deployment
has not been started, because it needs things only you can obtain — a server, the domain's
DNS, and an R2 bucket. This document is the ordered list.

Read `infra/RUNBOOK.md` for what to do *after* launch (restore, rotate, take down a title,
roll back).

---

## 0 · What you need before you start

| Thing | Why | Cost |
| --- | --- | --- |
| A server, 4 vCPU / 8 GB / 80 GB NVMe | web + worker + Postgres + Valkey | ~$25–45/mo (Hetzner CPX31, DigitalOcean, Vultr) |
| `palscans.org` on Cloudflare | DNS, TLS, the edge cache in front of the CDN host | domain cost only |
| A Cloudflare R2 bucket | page images and covers | see docs/08 — **zero egress** is the reason R2 was chosen |
| An SMTP sender (Resend, Postmark, SES) | verification and password-reset mail | free tier is enough at first |

Optional, and the site runs correctly without each one — the features degrade to an honest
"not configured" state rather than breaking:

| Thing | Unlocks |
| --- | --- |
| Google / Discord OAuth apps | one-click sign-in |
| Stripe account | the Premium tier and billing screens |
| Cloudflare Turnstile keys | bot protection on comments and sign-up |
| VAPID key pair | web push notifications |
| A Discord bot token | new-chapter announcements to your server |

The worker sizing matters more than the web app: image encoding is the only CPU-heavy thing
the platform does. 4 cores handles a normal release day comfortably.

---

## 1 · DNS

You create **two** records by hand. The third one R2 creates for you.

```
A      palscans.org    <server ip>     proxied (orange cloud)
CNAME  www             palscans.org    proxied (orange cloud)
```

Set SSL/TLS mode to **Full (strict)**. Caddy gets a real certificate on the origin, so
Flexible would be a downgrade.

**`cdn.palscans.org` does not point at your server.** Do not add an A record for it. In the
Cloudflare dashboard go to R2 → your bucket → *Settings* → *Public access* → **Connect
Domain**, and enter `cdn.palscans.org`. Cloudflare writes the DNS record itself, pointing at
R2's edge, and serves the bucket from its cache.

That is the whole point of choosing R2 (docs/08): page images are served by Cloudflare
directly from the bucket, so reader traffic — by far the largest thing this site does — never
touches your server and R2 charges nothing for egress. Pointing `cdn.` at your own IP would
route every page image through your box and throw that away.

The A record for `palscans.org` is only for the app itself: HTML, the admin panel, the API.

The `cdn.palscans.org` block in `infra/Caddyfile` is the self-hosted MinIO equivalent, for
running without R2. With R2 connected you can ignore it — nothing will resolve to it.

---

## 2 · Object storage

Create the R2 bucket (`palscans`) and an API token scoped to it. Then:

- make the `covers/` and `pages/` prefixes publicly readable — everything else stays private
- connect `cdn.palscans.org` as the bucket's custom domain (this is what creates that DNS
  record; see step 1 — it must not be an A record to your server)
- leave versioning **on** for those two prefixes; `infra/RUNBOOK.md`'s restore step depends on it

Keep the endpoint, bucket name, access key ID and secret to hand. **You do not put them in a
file** — they go into the admin panel in step 6.

Images are content-addressed, so a restored object is byte-identical and never needs a cache
purge. That property is worth preserving.

---

## 3 · The server

```sh
# Docker Engine + compose plugin, then:
git clone https://github.com/nullemon/pal.git /opt/palscans
cd /opt/palscans
cp .env.example .env
```

`.env` is short now. Only values needed *before* there is a database to read or a session to
authenticate the panel with live here; everything else is entered in the panel. See
`docs/19-credentials.md` for why each one cannot move.

```sh
SITE_URL=https://palscans.org          # must be https:// — the session cookies are Secure
SESSION_SECRET=$(openssl rand -base64 32)
INTERNAL_API_SECRET=$(openssl rand -base64 32)
CREDENTIALS_KEY=$(openssl rand -base64 32)
TRUSTED_PROXY=cloudflare               # or `xff` if Cloudflare is not in front
POSTGRES_PASSWORD=<a strong password>
DATABASE_URL=postgres://pal:<that password>@postgres:5432/palscans
```

The application **refuses to boot in production** with placeholder values — that guard is in
`apps/web/lib/env.ts` and it is deliberate.

Two of these deserve a sentence each:

`TRUSTED_PROXY` is not cosmetic. With it unset every visitor shares one rate-limit bucket and
no IP is ever hashed. Use `cloudflare` when Cloudflare proxies the origin, `xff` when only
Caddy is in front.

`CREDENTIALS_KEY` seals the credentials you are about to type into the panel. It is optional —
it falls back to `SESSION_SECRET` — but setting it separately now means you can rotate sessions
later without making every stored credential unreadable. It costs one line today and saves a
bad afternoon later.

---

## 4 · First boot

`infra/docker-compose.yml` brings up Postgres, Valkey, Caddy, web and worker — which is the
whole R2 deployment. MinIO and Mailpit exist for running without R2 and a real mail sender;
they sit behind a `selfhosted` profile and do not start unless you ask for them, so there is
nothing to delete.

```sh
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
docker compose --env-file .env -f infra/docker-compose.yml exec -w /repo web pnpm db:migrate
curl -s localhost:3000/api/health     # {"status":"ok","db":"up",...}
```

Two details in those commands are load-bearing, and both were wrong here until they were
actually run:

`--env-file .env` is required. Compose takes its project directory from the first `-f`
argument, so without it, it looks for `infra/.env` and never sees the file you just wrote.
The symptom is an immediate `required variable SESSION_SECRET is missing a value` and nothing
starting at all. Consider `alias dc='docker compose --env-file .env -f infra/docker-compose.yml'`.

`-w /repo` is required on the migrate command. The image's working directory is
`/repo/apps/web`, and `db:migrate` is a script on the *root* package, so without it you get
`Command "db:migrate" not found` — and, worse, a site that boots against an empty database
while `/api/health` still answers `ok`, because that endpoint only proves the database is
reachable, not that it has a schema.

If a required value is missing, compose stops and names it. That is deliberate: every
variable without a safe default is marked required, so a wrong deploy fails loudly instead of
starting a subtly broken site.

Migrations are additive by design — new columns and tables, never drops — which is what makes
the rollback procedure in the runbook safe.

**Do not run `pnpm db:seed` in production.** The seeder writes a demo catalogue of ~137
invented series *and* staff accounts whose password is a constant in this repository. It now
refuses to run against anything that is not loopback or PGlite, but do not go looking for the
override.

## 5 · Your admin account

There is no bootstrap flow: you register like any reader, then promote yourself once.

1. Open `https://palscans.org/register` and sign up.
2. Promote the account and mark it verified (skip the second line if mail already works):

```sh
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U pal -d palscans -c \
  "update users set role = 'admin', email_verified_at = now() where email = 'you@example.com'"
```

3. Sign in at `https://palscans.org/admin/login`.

Change the staff sign-in path immediately in **Admin → System → Access**. A custom path is
obscurity rather than access control — it will not stop anyone who knows it — but it cuts
automated scanner traffic, which is real. Pair it with the IP allowlist on the same screen if
you have a fixed address; that one actually restricts access. Both answer 404 rather than 403,
so a prober cannot tell the difference between "wrong path" and "not allowed".

---

## 6 · Credentials, in the panel

Everything below is **Admin → System → Integrations**. Each section has a **Test** button;
each field shows whether its current value comes from the panel, from the environment, or is
unset. Nothing here needs a redeploy.

Do these in order:

1. **Storage** — driver *S3 / Cloudflare R2*, then the endpoint, bucket, access key ID, secret
   and region (`auto` for R2), and the public CDN URL (`https://cdn.palscans.org`). Press
   **Test**: it writes a small object, reads it back, compares the bytes and deletes it. If
   that passes, your bucket works. Save.
2. **Email** — either a Resend API key, or SMTP host/port/username/password. Set the *from*
   address to something on your domain. Press **Test** to send yourself a message.
3. **Sign-in providers** *(optional)* — Google and Discord client IDs and secrets. The
   redirect URL to register with each provider is `https://palscans.org/api/auth/<provider>/callback`.
4. **Bot protection** *(recommended)* — Cloudflare Turnstile site key and secret. Without
   these every bot check passes.
5. **Payments** *(optional)* — the Stripe secret key and the webhook signing secret for an
   endpoint pointed at `https://palscans.org/api/webhooks/stripe`. Skip this entirely if you
   would rather make premium features free for everyone (see below).
6. **Web push** *(optional)* — generate a pair with `npx web-push generate-vapid-keys`.
7. **Discord** *(optional)* — bot token and server ID for new-chapter announcements.

The worker picks credential changes up within five minutes, or immediately if you restart it.

---

## 7 · Settings worth doing on day one

All in the admin panel, none require a redeploy:

- **Appearance → Theme** — accent colour, dark/light default, the outer-glow toggle (off).
- **Appearance → Layouts** — home, series and reader direction. All six directions are built;
  the shipping defaults are Home A and Series B.
- **System → SEO** — site name, title separator, the per-page-type templates
  (`{title} Chapter {chapter} {sep} {site}` gives `Naruto Chapter 208 - PALScans`), sitemap
  and feed URLs.
- **Business → Ads** — skyscrapers on desktop, the mobile interval (every 2/4/6 pages), network
  tags. Slots render as labelled placeholders until you paste a real tag.
- **Community → Comments** — link posts are held for review by default. Leave that on.
- **Business → Premium** — every premium feature can be switched to *Free for everyone* here,
  with no code change and no Stripe account.

## 8 · Migrating the old site

Admin → System → Importer, in this order:

1. **Export** the old database: `mysqldump --single-transaction --quick wordpress > legacy.sql`,
   and `rsync` the uploads directory to the server.
2. **Configure** the source: mode *SQL dump*, the dump's path, the uploads path, your table
   prefix. A live MySQL DSN is not supported in this build — export a dump.
3. **Discovery** — reads the dump and reports what it holds. Writes nothing.
4. **Dry run** — maps everything and counts it. Writes nothing. Download the review CSV and
   fix any chapter names the parser refuses to guess a number for ("Prologue", "Season 2
   Finale"); it never invents one.
5. **Start import.** Batched and resumable: pause and cancel land between batches, never
   mid-chapter, and a crashed worker restarts at the last committed batch. Running it a second
   time updates instead of duplicating — everything already imported reports as skipped.

Two things the import deliberately does not do. **Passwords are never converted** — WordPress
phpass hashes are dropped, and accounts arrive with no password, so tell your readers to use
"forgot password" at cutover. **Guest comments** from people who never had an account are
counted as skipped rather than attached to an invented user; the panel shows the number.

Redirect rows are generated for every legacy URL (`/manga/<slug>/chapter-12/` →
`/series/<slug>/chapter-12`) and land in the existing redirects table, so old links keep
working and the search rankings transfer.

---

## 9 · Before you announce it

Walk these in a private window:

- [ ] `/` renders; covers load from `cdn.palscans.org`, not the app host
- [ ] a series page, then a chapter — pages render, the reader settings sheet opens
- [ ] register a throwaway account; the verification mail arrives
- [ ] post a comment containing a link — it should be **held**, not published
- [ ] `/admin` loads for you and 404s for the throwaway account
- [ ] `/sitemap.xml` and `/robots.txt` list your real domain
- [ ] upload one chapter through Admin → Content → Chapters and watch it process
- [ ] `docker compose logs worker` shows the scheduler ticking, no errors
- [ ] `curl https://palscans.org/api/health` returns `{"status":"ok"}` — point your uptime
      monitor at it
- [ ] every section of Admin → System → Integrations that you configured shows source
      **panel**, and its **Test** passes

Then submit the sitemap to Google Search Console and set up a nightly `pg_dump` to R2 under
`backups/pg/` — the runbook's restore step assumes it exists.

---

## Known gaps

Honest list of what is not there, so nothing surprises you at 2am:

- **No live MySQL DSN connector.** It needs the `mysql2` driver. The dump path covers the same
  ground and does not require exposing your old database to the internet.
- **No uploads-archive reader.** A `.zip`/`.tar` of the uploads tree has to be extracted first
  and given as a path.
- **Stripe, VAPID and the Discord bot are written but inert** until their credentials are set
  in the panel. Every screen degrades to a clear "not configured" state rather than erroring.
- **A credential change reaches other processes within five minutes**, not instantly — the
  store is cached for 300s per process. Restart the worker if you need it sooner.
- **`CREDENTIALS_KEY` has no re-key command.** Rotating it means re-entering the credentials
  in the panel.
- **Deleting a reader's preference rows is a hard delete** (bookmarks, ratings, reactions,
  history). Everything else is soft-deleted and recoverable.
