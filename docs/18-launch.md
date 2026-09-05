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
| A Cloudflare R2 bucket | every object the app stores | see docs/08 — **zero egress** is the reason R2 was chosen |
| A *second* R2 bucket, never made public | nightly database dumps (§9) | pennies; it holds one small file a day |
| An SMTP sender (Resend, Postmark, SES) | verification and password-reset mail | free tier is enough at first |
| An authenticator app (1Password, Aegis, Google Authenticator…) | **required**: the admin role cannot use the panel without TOTP (§5) | free |

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

**`cdn.palscans.org` does not point at your server.** Do not add an A record for it. It is
created for you when you connect the bucket's custom domain — **do that in §2, not here**, and
read §2 first: connecting the domain makes *every object in the bucket* world-readable, and
one of the prefixes in there is your raw uploads. Cloudflare writes the DNS record itself,
pointing at R2's edge, and serves the bucket from its cache.

That is the whole point of choosing R2 (docs/08): page images are served by Cloudflare
directly from the bucket, so reader traffic — by far the largest thing this site does — never
touches your server and R2 charges nothing for egress. Pointing `cdn.` at your own IP would
route every page image through your box and throw that away.

The A record for `palscans.org` is only for the app itself: HTML, the admin panel, the API.

The `cdn.palscans.org` block in `infra/Caddyfile` is the self-hosted MinIO equivalent, for
running without R2. With R2 connected you can ignore it — nothing will resolve to it.

---

## 2 · Object storage

Create the R2 bucket (`palscans`) and an API token scoped to it. Keep the endpoint, bucket
name, access key ID and secret to hand. **You do not put them in a file** — they go into the
admin panel in step 6.

Then read the rest of this section before you press **Connect Domain**. Getting it wrong
publishes things that must not be published.

### What is in the bucket

The app uses **one** bucket for everything it stores, and only some of it is meant to be
public. These are the keys the code actually writes:

| Prefix | What it is | Written by | Public? |
| --- | --- | --- | --- |
| `covers/<slug>/<sha>.<w>.<fmt>` | re-encoded covers | `apps/worker/src/jobs/series-art.ts` | **yes** |
| `banners/<slug>/<sha>.<w>.<fmt>` | re-encoded banners | same | **yes** |
| `pages/<seriesId>/<chapterId>/…` | re-encoded page images | `apps/worker/src/jobs/chapter-process.ts` | **yes** (but see the premium note below) |
| `avatars/<userId>/<sha>.webp` | re-encoded reader avatars | `apps/web/lib/auth/avatar.ts` | **yes** |
| `uploads/<seriesId>/<chapterId>/…` | the **raw files you uploaded**, exactly as they came off your disk, for every chapter including premium ones — never deleted | `apps/web/app/api/upload/intent/route.ts`, `apps/worker/src/jobs/import/chapters.ts` | **no** |
| `uploads/art/<seriesId>/…` | raw cover/banner originals (deleted once processed) | `apps/web/app/api/admin/series/[id]/art/route.ts` | **no** |
| `sitemaps/…` | built sitemap files — the app reads them server-side and serves them itself | `apps/web/lib/seo/sitemaps.ts` | **no** |
| `_healthcheck/…` | the object Integrations → Storage **Test** writes and deletes | `apps/web/lib/config/tests.ts` | **no** |

The `uploads/` prefix is the one that matters. It is the un-re-encoded original of every page
of every chapter — including premium chapters — kept permanently so a failed encode can be
retried, and it carries whatever EXIF the source had.

### R2 has no per-prefix public access

There is no way to publish `covers/` and `pages/` and keep the rest private at the bucket
level. R2 has no bucket policies and no per-prefix ACL; **public access is all-or-nothing per
bucket**, and connecting a custom domain turns it on for every object. (Per-prefix anonymous
access is a *MinIO* feature — it is what `minio-init` does in `infra/docker-compose.yml`
under the `selfhosted` profile, and it is where the earlier version of this section came
from. It does not transfer to R2.)

Cloudflare's own answer is: put the bucket behind a custom domain, then restrict it with the
zone's security products. That works because a custom domain is a hostname in *your* zone, so
WAF custom rules, cache rules and Access all apply to it — none of which are available on the
`r2.dev` development URL.

### Do this

1. **R2 → your bucket → Settings → Public access → Connect Domain**, enter
   `cdn.palscans.org`. Cloudflare writes the DNS record itself (step 1 — it must not be an A
   record to your server).
2. **Leave the `r2.dev` development URL disabled.** It is a Cloudflare-managed hostname
   outside your zone, so nothing you configure below applies to it; if it is on, the whole
   bucket stays reachable through it no matter what the WAF says. Check
   **Public access → Public Development URL** reads *Not allowed*.
3. Add one **WAF custom rule** on the `palscans.org` zone
   (Security → WAF → Custom rules → Create rule). Edit it as an *expression*, not with the
   visual builder:

   ```
   (http.host eq "cdn.palscans.org"
     and not starts_with(http.request.uri.path, "/covers/")
     and not starts_with(http.request.uri.path, "/banners/")
     and not starts_with(http.request.uri.path, "/pages/")
     and not starts_with(http.request.uri.path, "/avatars/"))
   ```

   Action: **Block**. Custom rules are available on every plan, including Free (5 rules), and
   `starts_with()` needs no paid plan either.

   The four allowed prefixes are exactly the "public" rows in the table above. If you ever
   add a prefix that the browser must fetch, it goes in this rule too — otherwise it 403s
   with no other symptom.

4. **Verify it, from a machine that is not signed in to anything:**

   ```sh
   CDN=https://cdn.palscans.org
   code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

   # must be 200 — paste a real cover key from Admin → Content → Series
   echo "cover     $(code "$CDN/covers/<slug>/<sha>.640.webp")"

   # must all be 403
   for p in /uploads/probe /uploads/art/probe /sitemaps/sitemap.xml /_healthcheck/probe /; do
     echo "$p  $(code "$CDN$p")"
   done
   ```

   The deliberate trick in the second loop is that those paths do not exist. An **unprotected**
   bucket answers `404` for a missing key; the WAF rule answers `403` before R2 is ever asked.
   So `403` on all five means the rule is live and matching; a `404` anywhere means it is not,
   and your bucket is open. A `200` means it is not, and something real is being served.

5. Re-run the check after any change to the bucket's public-access settings, and after adding
   any prefix to the rule.

### What this does and does not protect

**It does** stop anyone from reading your raw uploads, your sitemap files or a directory
listing over `cdn.palscans.org`, which is the exposure that matters here.

**It does not** make premium pages private. Page images for locked chapters live under
`pages/` alongside free ones, and the app protects them by handing subscribers a *presigned*
URL against the R2 S3 endpoint that expires after two hours
(`apps/web/lib/storage/upload.ts`, `SIGNED_URL_TTL_SEC = 7200`). The same object is also
reachable, unsigned and forever, at `https://cdn.palscans.org/<that key>`. The only thing
standing in the way is that the key contains a 12-hex-character content hash, so it cannot be
guessed — but it *can* be copied out of a presigned URL and shared, and the copy will not
expire. Treat premium page keys as secrets, not as access control. Splitting `pages/` across
two buckets is not possible without a code change: the app has exactly one bucket setting.

**It is a single control.** Delete the rule, or turn the `r2.dev` URL back on, and the whole
bucket is public again with no other warning. Note it wherever you keep the runbook.

### Backups do not go in this bucket

Create a **second** R2 bucket for them (`palscans-backups`), and never connect a domain to it.
A database dump inside a bucket that has a public hostname attached is one WAF-rule mistake
away from being downloadable. §9 and `infra/RUNBOOK.md` both assume the separate bucket.

### Two things the old version of this document got wrong

- It said to make prefixes public. R2 cannot; see above.
- It said to "leave versioning on" for `covers/` and `pages/`, and the runbook's object
  restore depended on it. **R2 has no object versioning at all** — `GetBucketVersioning` and
  `PutBucketVersioning` are both on Cloudflare's unimplemented list. Object recovery is
  whatever you copy elsewhere yourself (`rclone sync` to the backups bucket); there is no
  undelete.

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

Edit `.env` by hand for the values that are yours to choose:

```sh
SITE_URL=https://palscans.org          # must be https:// — the session cookies are Secure
TRUSTED_PROXY=cloudflare               # or `xff` if Cloudflare is not in front
POSTGRES_PASSWORD=<a strong password>
DATABASE_URL=postgres://pal:<that password>@postgres:5432/palscans
```

Then **generate** the three secrets — run this in the shell, so the shell does the
substitution and only the result reaches the file:

```sh
sed -i '/^SESSION_SECRET=/d' .env          # drop the placeholder from .env.example
{
  echo "SESSION_SECRET=$(openssl rand -base64 32)"
  echo "INTERNAL_API_SECRET=$(openssl rand -base64 32)"
  echo "CREDENTIALS_KEY=$(openssl rand -base64 32)"
} >> .env
grep -E '^(SESSION_SECRET|INTERNAL_API_SECRET|CREDENTIALS_KEY)=' .env
```

Each line printed back should look like
`SESSION_SECRET=9w/DqWQDIJT/49BCl5p9BlHfAVi5hWdc6eKjw+03Tac=` — 44 characters of base64, no
`$`, no quotes, and each one different from the others.

**Do not type `SESSION_SECRET=$(openssl rand -base64 32)` into the file.** A `.env` file is
not a shell script: neither Docker Compose, nor Node's `--env-file`, nor `@next/env` evaluates
anything in it, so the value becomes the literal 26-character string
`$(openssl rand -base64 32)` — the same 26 characters on every deployment that copies this
document. It then fails in two different ways, and only one of them is visible:

- `SESSION_SECRET` is the lucky one — 26 characters is below the 32-character production
  minimum in `apps/web/lib/env.ts`, so the web container refuses to boot and names it.
- `CREDENTIALS_KEY` has **no** such check. The sealing key only needs 16 characters
  (`packages/core/src/secrets.ts`), so 26 passes, the panel cheerfully reports *Sealed with
  CREDENTIALS_KEY*, and every credential you then type in — R2 keys, the Stripe secret, SMTP
  password — is encrypted with a string printed in this document. Fix `SESSION_SECRET`
  because the boot error told you to, and this one stays broken.

The application **refuses to boot in production** with placeholder values — that guard is in
`apps/web/lib/env.ts` and it is deliberate. It does not, and cannot, tell you that a
well-formed secret is one somebody else can guess.

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

Migrations only ever go forward: there are no down migrations, and nothing removes a column or
table that the previous release still reads. That is not the same as "never drops" — two of
them do drop things, and both replace the object in the same file:
`0003_view_events_partition.sql` drops `view_events` to recreate it partitioned by day
(the rows in it are lost; on a new install there are none), and
`9014_rating_counter_safety.sql` drops `series.rating_avg` to re-add it as a generated column.
The undo for a bad migration is the pre-deploy dump, never a hand-written down migration —
see "Roll back a deploy" in `infra/RUNBOOK.md`.

**Do not run `pnpm db:seed` in production.** The seeder writes a demo catalogue of ~137
invented series *and* staff accounts whose password is a constant in this repository. It now
refuses to run against anything that is not loopback or PGlite, but do not go looking for the
override.

## 5 · Your admin account

There is no bootstrap flow: you register like any reader, then promote yourself once.

1. Open `https://palscans.org/register` and sign up.
2. Promote the account and mark it verified (skip the second line if mail already works):

```sh
docker compose --env-file .env -f infra/docker-compose.yml exec postgres \
  psql -U pal -d palscans -c \
  "update users set role = 'admin', email_verified_at = now() where email = 'you@example.com'"
```

(`--env-file .env` on *every* compose command, `exec` included — compose interpolates the
whole file before it looks at the subcommand, so without it this fails with
`required variable SITE_URL is missing a value` and never reaches psql. This is the same trap
as in §4.)

3. Sign in at `https://palscans.org/admin/login`.

4. **Set up TOTP — you cannot use the panel until you do.** Have the authenticator app ready
   before you run step 2: the moment that UPDATE lands you are an admin, and an admin without
   a second factor cannot open the panel at all.

   The admin role is required to hold a second factor (docs/07). `apps/web/app/admin/layout.tsx`
   redirects any admin with no `totp_enabled_at` to `/me/security?totp=required`, and every
   admin API route behind `withPermission()` answers `403 totp_required`
   (`apps/web/lib/auth/http.ts`) — reads included, so the panel does not half-work. What you
   will actually see after promoting yourself is `/admin` bouncing you to your own security
   page. That is this, not a broken deploy.

   On `/me/security`: **Two-factor authentication → Set up two-factor**, confirm with your
   password, scan the QR code with the app, type the six-digit code and press **Turn on**.
   Then go back to `/admin`.

   Two things to know before you do it:

   - **There are no recovery codes.** The feature does not exist in this build; there is no
     `recovery_codes` table and nothing issues one. Lose the authenticator and the only way
     back in is the database:

     ```sh
     docker compose --env-file .env -f infra/docker-compose.yml exec postgres \
       psql -U pal -d palscans -c \
       "update users set totp_secret = null, totp_enabled_at = null where email = 'you@example.com'"
     ```

     Which means: enrol on a device whose backups you trust, or add the same secret to a
     second authenticator while the QR code is on screen.
   - **Turning it on signs out your other devices.** The browser you enrol in stays signed
     in; everything else has to sign in again, now with a code.

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

The worker picks credential changes up within **30 seconds**, or immediately if you restart it
(`CREDENTIAL_TTL_MS` in `apps/worker/src/lib/config.ts`; the web app's own cache in
`apps/web/lib/config/store.ts` is the same 30s).

---

## 7 · Settings worth doing on day one

All in the admin panel, none require a redeploy:

- **Appearance → Theme** — accent colour, dark/light default, the outer-glow toggle (off).
- **Appearance → Layouts** — home, series and reader direction. All six directions are built;
  the shipping defaults are Home A and Series B.
- **System → SEO** — site name, title separator, the per-page-type templates
  (`{title} Chapter {chapter} {sep} {site}` gives `Naruto Chapter 208 - PALScans`), sitemap
  and feed URLs.
- **Business → Ads** — skyscrapers on desktop, the mobile interval (every 2/4/6 pages), and a
  tag box per slot. Paste the network's snippet and it renders and runs in that slot on the
  next request; leave it empty and the box stays reserved at its final size so nothing shifts
  when you do fill it. Nine slots: three on the home page, two on a series page, three in the
  reader, and the mobile anchor. `ads.txt` is on the same screen and is served at `/ads.txt`
  verbatim. Nothing renders at all for a reader holding `no_ads`.
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
- [ ] **the §2 bucket check passes**: `https://cdn.palscans.org/uploads/probe` answers **403**,
      not 404 and not 200. This is the one that costs you if it is wrong.
- [ ] a series page, then a chapter — pages render, the reader settings sheet opens
- [ ] register a throwaway account; the verification mail arrives
- [ ] post a comment containing a link — it should be **held**, not published
- [ ] `/admin` loads for you and 404s for the throwaway account
- [ ] `/sitemap.xml` and `/robots.txt` list your real domain
- [ ] upload one chapter through Admin → Content → Chapters and watch it process
- [ ] `docker compose --env-file .env -f infra/docker-compose.yml logs worker` shows the
      scheduler ticking, no errors
- [ ] `curl https://palscans.org/api/health` returns `{"status":"ok"}` — point your uptime
      monitor at it
- [ ] every section of Admin → System → Integrations that you configured shows source
      **panel**, and its **Test** passes

- [ ] **Admin → System → Backup** shows a green run — press **Back up now** once and watch it
- [ ] the `rclone sync` cron job from `infra/RUNBOOK.md` → **Backups → 2** is installed;
      without it there is no object backup at all
- [ ] you have read `docs/20-performance.md` and know what this box does per second

Then submit the sitemap to Google Search Console.

### The nightly database backup

**This one ships with the application.** The worker enqueues `db.backup` every
`WORKER_BACKUP_MS` (24 h), and **Admin → System → Backup** runs the same job on demand and
shows the last run's outcome. There is no cron entry to install; there are four lines to put
in `.env`:

```sh
BACKUP_S3_BUCKET=palscans-backups        # the SECOND bucket from §2 — never `palscans`
BACKUP_S3_ACCESS_KEY_ID=…                # optional; falls back to the app's S3_* values
BACKUP_S3_SECRET_ACCESS_KEY=…
# BACKUP_RETENTION_DAYS=14
```

Then `dc up -d worker`, open **Admin → System → Backup**, press **Back up now**, and watch the
row turn green. With nothing configured the panel reads *Not configured* rather than pretending
— which is the honest answer, and the reason to look at the screen once on launch day.

Full details, including how to check it from the shell, are in `infra/RUNBOOK.md` under
**Backups**.

The format matters. `infra/RUNBOOK.md` restores with `pg_restore`, which **cannot read a plain
SQL dump** — a default `pg_dump` writes SQL text, and `pg_restore` answers
`input file appears to be a text format dump. Please use psql.` and exits 1. Use
`--format=custom`. The job does; so does the script below.

#### If you would rather run it on the host

The job takes the dump inside the worker container and uploads it in one piece, so a database
larger than `BACKUP_MAX_BYTES` (1 GiB) is the case it does not cover. This script is the
equivalent on the host, and is what the job was modelled on. Put it in
`/usr/local/bin/palscans-backup` (`chmod +x`):

```sh
#!/bin/sh
set -eu
cd /opt/palscans
DC="docker compose --env-file .env -f infra/docker-compose.yml"
STAMP=$(date -u +%F)
DIR=/var/backups/palscans
OUT="$DIR/palscans-$STAMP.dump"
mkdir -p "$DIR"

$DC exec -T postgres pg_dump -U pal -d palscans --format=custom --compress=9 > "$OUT"

# fail loudly rather than shipping a truncated or plain-text file.
# pg_restore runs in the container, so the host needs no postgres client tools.
$DC exec -T postgres pg_restore -l < "$OUT" > /dev/null

rclone copyto "$OUT" "r2-backups:palscans-backups/pg/palscans-$STAMP.dump"
find "$DIR" -name '*.dump' -mtime +7 -delete
```

and schedule it — `/etc/cron.d/palscans-backup`, one line, note the required trailing newline:

```
17 4 * * *  root  /usr/local/bin/palscans-backup >> /var/log/palscans-backup.log 2>&1
```

Three things in the script are load-bearing:

- **`--format=custom`** is what makes the runbook's restore command work at all.
- **`pg_restore -l` on the result** is the cheapest possible verification that you have a
  restorable archive and not 0 bytes of nothing. A backup nobody has ever read back is not a
  backup.
- **`r2-backups:` is the second bucket from §2, the one with no custom domain.** Do not write
  dumps into the `palscans` bucket: it has a public hostname attached, and the dump contains
  every user row, every session, and the sealed `app_credentials` table.

Once a month, actually restore it somewhere and count the rows. The exact command is in
`infra/RUNBOOK.md` under **Restore**; it takes about two minutes.

#### The restore test that was actually run

Not a claim — a record, so the next person knows the procedure in the runbook has been walked
end to end at least once. On **2026-09-05**, against the development database (137 series,
4 968 chapters, 54 837 chapter pages, 38 users):

1. `db.backup` ran and wrote `pg/palscans-2026-09-05T0013Z.dump` — **538 206 bytes**, **480**
   objects reported by `pg_restore -l`, in **371 ms**.
2. `pg_restore --exit-on-error` into a scratch database (the **cautious variant** in
   `infra/RUNBOOK.md` → Restore → 1) exited **0** with no output.
3. Row counts compared **table by table across all 70 tables**: identical, **69 729 rows**
   before and after.
4. The two things a restore of this schema can quietly get wrong were checked explicitly: the
   partitioned `view_events` came back with its **5 partitions**, and `series.rating_avg` came
   back as a **generated** column (`attgenerated = 's'`), not a plain one.

The scratch database was dropped afterwards. What this does *not* prove is the
`--clean --create` drop-and-recreate path in the runbook, which by design destroys the
database it is pointed at; it was not run against a shared database. Walk that one on the real
server the first time you need it, or on a throwaway host.

That covers the database. **Objects are still not backed up by anything the application
runs** — R2 has no versioning, so a deleted image is gone. The `rclone sync` cron job in
`infra/RUNBOOK.md` under **Backups → 2 · Object storage** is a thing you install on the host,
by hand, and it is the only object backup that will ever exist. Do it on launch day.

---

## Known gaps

Honest list of what is not there, so nothing surprises you at 2am:

- **No live MySQL DSN connector.** It needs the `mysql2` driver. The dump path covers the same
  ground and does not require exposing your old database to the internet.
- **No uploads-archive reader.** A `.zip`/`.tar` of the uploads tree has to be extracted first
  and given as a path.
- **Stripe, VAPID and the Discord bot are written but inert** until their credentials are set
  in the panel. Every screen degrades to a clear "not configured" state rather than erroring.
- **A credential change reaches other processes within 30 seconds**, not instantly — the store
  is memoised for 30s per process, in memory only. Restart the worker if you need it sooner.
- **`CREDENTIALS_KEY` has no re-key command.** Rotating it means re-entering the credentials
  in the panel.
- **Deleting a reader's preference rows is a hard delete** (bookmarks, ratings, reactions,
  history). Everything else is soft-deleted and recoverable.
