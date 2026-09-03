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

Two records on Cloudflare, both proxied (orange cloud):

```
A     palscans.org       <server ip>     proxied
A     cdn.palscans.org   <server ip>     proxied
CNAME www                palscans.org    proxied
```

Set SSL/TLS mode to **Full (strict)**. Caddy gets a real certificate on the origin, so
Flexible would be a downgrade.

`cdn.palscans.org` points at the server only in the self-hosted (MinIO) shape. If you use R2
— which you should — point it at the bucket's public hostname instead and let Cloudflare
cache it. Either way `PUBLIC_CDN_URL` is what the app writes into image URLs.

---

## 2 · Object storage

Create the R2 bucket (`palscans`) and an API token scoped to it. Then:

- make the `covers/` and `pages/` prefixes publicly readable — everything else stays private
- connect `cdn.palscans.org` as the bucket's custom domain
- leave versioning **on** for those two prefixes; `infra/RUNBOOK.md`'s restore step depends on it

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

Fill `.env`. The application **refuses to boot in production** with placeholder values — that
guard is in `apps/web/lib/env.ts` and it is deliberate. These five are mandatory:

```sh
SITE_URL=https://palscans.org          # must be https:// — the session cookies are Secure
SESSION_SECRET=$(openssl rand -base64 32)
INTERNAL_API_SECRET=$(openssl rand -base64 32)
TRUSTED_PROXY=cloudflare               # or `xff` if Cloudflare is not in front
DATABASE_URL=postgres://pal:<password>@postgres:5432/palscans
```

`TRUSTED_PROXY` is not cosmetic: with it unset every visitor shares one rate-limit bucket and
no IP is ever hashed. Use `cloudflare` when Cloudflare proxies the origin (it reads
`CF-Connecting-IP`), `xff` when only Caddy is in front.

Then storage and the rest:

```sh
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_BUCKET=palscans
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto
PUBLIC_CDN_URL=https://cdn.palscans.org
REDIS_URL=redis://valkey:6379
POSTGRES_PASSWORD=<same password as in DATABASE_URL>
```

Secrets live only here, never in the repo or the image.

---

## 4 · First boot

`infra/docker-compose.yml` brings up Postgres, Valkey, MinIO, Mailpit, Caddy, web and worker.
For an R2 deployment you do not need the `minio` / `minio-init` services — drop them and point
`S3_ENDPOINT` at R2. Mailpit is a development mail catcher; replace it with real SMTP.

```sh
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml exec web pnpm db:migrate
```

Migrations are additive by design — new columns and tables, never drops — which is what makes
the rollback procedure in the runbook safe.

**Do not run `pnpm db:seed` in production.** The seeder writes a demo catalogue of ~137
invented series. It exists for development and tests.

---

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

## 6 · Settings worth doing on day one

All in the admin panel, none require a redeploy:

- **Appearance → Theme** — accent colour, dark/light default, the outer-glow toggle (off).
- **Appearance → Layouts** — home, series and reader direction. All six directions are built;
  the shipping defaults are Home A and Series B.
- **System → SEO** — site name, title separator, the per-page-type templates
  (`{title} Chapter {chapter} {sep} {site}` gives `Naruto Chapter 208 - PALScans`), sitemap
  and feed URLs.
- **Business → Ads** — skyscrapers on desktop, the mobile interval (every 2/4/6 pages), network tags.
  Slots render as labelled placeholders until you paste a real tag.
- **Community → Comments** — link posts are held for review by default. Leave that on.
- **Business → Premium** — every premium feature can be switched to *Free for everyone* here, with
  no code change and no Stripe account.

---

## 7 · Migrating the old site

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

## 8 · Before you announce it

Walk these in a private window:

- [ ] `/` renders; covers load from `cdn.palscans.org`, not the app host
- [ ] a series page, then a chapter — pages render, the reader settings sheet opens
- [ ] register a throwaway account; the verification mail arrives
- [ ] post a comment containing a link — it should be **held**, not published
- [ ] `/admin` loads for you and 404s for the throwaway account
- [ ] `/sitemap.xml` and `/robots.txt` list your real domain
- [ ] upload one chapter through Admin → Content → Chapters and watch it process
- [ ] `docker compose logs worker` shows the scheduler ticking, no errors

Then submit the sitemap to Google Search Console and set up a nightly `pg_dump` to R2 under
`backups/pg/` — the runbook's restore step assumes it exists.

---

## Known gaps

Honest list of what is not there, so nothing surprises you at 2am:

- **No `/api/health` endpoint.** Nothing depends on one today (the compose file does not
  health-check `web`), but any uptime monitor will want one.
- **No live MySQL DSN connector.** It needs the `mysql2` driver. The dump path covers the same
  ground and does not require exposing your old database to the internet.
- **No uploads-archive reader.** A `.zip`/`.tar` of the uploads tree has to be extracted first
  and given as a path.
- **Stripe, VAPID and the Discord bot are written but inert** until their credentials are set.
  Every screen degrades to a clear "not configured" state rather than erroring.
- **Deleting a reader's preference rows is a hard delete** (bookmarks, ratings, reactions,
  history). Everything else is soft-deleted and recoverable.
