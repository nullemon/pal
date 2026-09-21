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

You create **two** records by hand. The third is created for you when you connect the image
bucket's domain in §2.

```
A      palscans.org    <server ip>     proxied (orange cloud)
CNAME  www             palscans.org    proxied (orange cloud)
```

Set SSL/TLS mode to **Full (strict)**. Caddy gets a real certificate on the origin, so
Flexible would be a downgrade.

**The image hostname does not point at your server.** Do not add a record for it. It is
created when you connect the custom domain to the image bucket in §2, and Cloudflare writes
it itself, pointing at R2's edge.

That is the whole point of choosing R2 (docs/08): page images are served by Cloudflare
directly from the bucket, so reader traffic — by far the largest thing this site does — never
touches your server, and R2 charges nothing for egress. Pointing the image hostname at your
own IP would route every page image through your box and throw that away.

The A record for `palscans.org` is only for the app itself: HTML, the admin panel, the API.

The `cdn.palscans.org` block in `infra/Caddyfile` is the self-hosted MinIO equivalent, for
running without R2. With R2 connected you can ignore it — nothing will resolve to it.

---

## 2 · Object storage

### Three buckets, and why

The site stores three kinds of thing with three different risk profiles, so they get three
buckets. The app routes every object by its key prefix and there is no way to pass the wrong
one — `packages/core/src/storage/profiles.ts` is the routing table, and it is the security
boundary, so it is deliberately short enough to read in one go.

| Bucket | Holds | Custom domain | Why |
| --- | --- | --- | --- |
| `palimages` | `covers/` `banners/` `pages/` `avatars/` `brand/` | **yes** — e.g. `palimages.org` | what a reader's browser fetches |
| `palscans-vault` | `uploads/` `sitemaps/` `_healthcheck/` | **never** | raw originals; unreachable by construction |
| `palscans-image-backup` | a copy of everything durable | **never** | R2 has no versioning, so this is the only undelete |

Plus a fourth, `palscans-backups`, for nightly **database** dumps (§9). Four buckets sounds
like a lot; they cost $0.015/GB/month each and creating one takes about fifteen seconds.

**Why the vault is separate, specifically.** R2 has no bucket policies and no per-prefix ACL:
**public access is all-or-nothing per bucket**, and connecting a custom domain turns it on for
every object. Page images need a public hostname. Your raw uploads — the un-re-encoded
original of every page of every chapter, including premium ones, carrying whatever EXIF the
source had — must not have one. In one bucket those two requirements are in direct conflict,
and the earlier version of this document resolved it with a Cloudflare WAF rule listing the
public prefixes. That worked, and it was **a single control**: delete the rule, or turn the
`r2.dev` URL back on, and every original you had ever uploaded was downloadable, with nothing
else in the way and no other symptom. A bucket with no hostname attached cannot leak that way,
because there is no address to leak through.

### Do this

1. Create `palimages`, `palscans-vault` and `palscans-image-backup`. Create an API token
   scoped to them. **You do not put the keys in a file** — they go into the admin panel in
   step 6.
2. On **`palimages` only**: Settings → Public access → **Connect Domain**, enter
   `palimages.org` (or `cdn.palimages.org` — whatever you set as the Public image URL in the
   panel). Cloudflare writes the DNS record itself.
3. **Connect no domain to the other two, ever.** That is the whole mechanism.
4. **Leave the `r2.dev` development URL disabled on all of them.** It is a Cloudflare-managed
   hostname outside your zone, so nothing you configure in your zone applies to it; if it is
   on, that bucket is reachable through it no matter what your WAF says. Check
   **Public access → Public Development URL** reads *Not allowed*.
5. Add one **WAF custom rule** on the `palscans.org` zone (Security → WAF → Custom rules).
   Edit it as an *expression*, not with the visual builder:

   ```
   (http.host eq "palimages.org"
     and not starts_with(http.request.uri.path, "/covers/")
     and not starts_with(http.request.uri.path, "/banners/")
     and not starts_with(http.request.uri.path, "/pages/")
     and not starts_with(http.request.uri.path, "/avatars/")
     and not starts_with(http.request.uri.path, "/brand/"))
   ```

   Action: **Block**. Custom rules are on every plan including Free.

   This is now belt and braces rather than the only thing standing between a stranger and
   your uploads: there is nothing private in this bucket to protect. It still earns its place
   — it refuses a directory listing, and it fails closed if a future prefix is added to the
   public routing table without anyone thinking about it.

### Verify it, from a machine that is not signed in to anything

```sh
IMG=https://palimages.org
code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

# must be 200 — paste a real cover key from Admin → Content → Series
echo "cover   $(code "$IMG/covers/<slug>/<sha>.640.webp")"

# must all be 403
for p in /uploads/probe /sitemaps/sitemap.xml /_healthcheck/probe /; do
  echo "$p  $(code "$IMG$p")"
done
```

The deliberate trick in the second loop is that those paths do not exist **and no longer
could**, because nothing writes them to this bucket. An unprotected bucket answers `404` for
a missing key; the WAF rule answers `403` before R2 is ever asked. So `403` everywhere means
the rule is live; a `404` means it is not matching, and a `200` means something real is being
served and you have the buckets crossed over.

Press **Test** on Admin → System → Integrations → Storage as well. It round-trips each
configured bucket and — the check worth having — refuses to pass if two of the three names
turn out to be the same bucket, which every individual round trip would otherwise report as
working perfectly.

### What this does and does not protect

**It does** put your raw uploads somewhere with no internet-facing address at all.

**It does not** make premium pages private. Page images for locked chapters live under
`pages/` alongside free ones and must, because the reader's browser has to fetch them. The app
hands subscribers a *presigned* URL that expires after two hours
(`apps/web/lib/storage/upload.ts`, `SIGNED_URL_TTL_SEC = 7200`), but the same object is also
reachable, unsigned and forever, at `https://palimages.org/<that key>`. The only thing in the
way is that the key contains a 12-hex-character content hash, so it cannot be guessed — but it
*can* be copied out of a presigned URL and shared, and the copy will not expire. Treat premium
page keys as secrets, not as access control.

### The image mirror

Every durable object is copied into `palscans-image-backup`, because **R2 has no object
versioning** — `GetBucketVersioning` and `PutBucketVersioning` are both on Cloudflare's
unimplemented list — so without a copy somewhere else, a deleted or corrupted image is simply
gone.

Two things feed it, and both are needed:

- **At write time.** Everything the app and worker produce — page variants, covers, banners,
  avatars — is queued for mirroring the moment it is written.
- **An hourly reconcile sweep.** Uploads from the admin panel go from your *browser* straight
  to a presigned URL, so the raw originals never pass through the server and nothing there can
  notice them. The sweep lists both sides and queues the difference. It is two listings and a
  set difference, not a request per object, so it stays cheap at fifty thousand pages. It is
  also the repair path for anything a failed job dropped.

Each copy is verified by size after it is written: a truncated copy is indistinguishable from
a good one until the day you need it, so the job checks now and retries rather than reporting
a backup it does not have. A delete on the primary is deliberately **not** propagated —
surviving an accidental delete is most of what this is for.

`WORKER_MIRROR_MS` (default 1 h) and `WORKER_MIRROR_BATCH` (default 2 000 objects per sweep)
tune it. The batch cap matters on the first sweep of an existing site, which has everything to
do at once and would otherwise starve the jobs readers are waiting on; the sweep reports that
it stopped early rather than claiming to be finished.

### Database backups do not go in any of these

Create a **fourth** bucket, `palscans-backups`, and never connect a domain to it either. §9
and `infra/RUNBOOK.md` both assume the separate bucket. A database dump contains every user
row, every session and the sealed `app_credentials` table.

### Two things the old version of this document got wrong

- It said to make prefixes public. R2 cannot; see above. The answer is separate buckets.
- It said to "leave versioning on" for `covers/` and `pages/`, and the runbook's object
  restore depended on it. **R2 has no object versioning at all.** That is what the mirror
  above exists to replace.

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
bad afternoon later. Since the pre-launch security pass it also seals every enrolled TOTP
secret (`users.totp_secret_sealed`), so it is no longer only about the integrations screen: a
database dump taken without this key set hands over working second factors.

### Lock the origin down

**This is the one step in this document that only you can do, and the pre-launch audit's
highest finding.** Do it the same afternoon you point DNS at the server.

`TRUSTED_PROXY=cloudflare` means the app believes `CF-Connecting-IP`. That is right for a
request that arrived through Cloudflare and it is a text box for anyone who connects to your
server's address directly on 443. The audit did exactly that: one header, and it was inside
the panel's IP allowlist and had a private bucket for every per-IP rate limit on the site
(login, register, comments, the reader). Cloudflare in front of you is not a boundary until
the origin refuses everything else — your server's address is in certificate-transparency
logs, in old DNS history, and in the headers of any mail the box has ever sent.

Two layers. The first is already done for you:

1. **`infra/Caddyfile` strips the CF-\* headers from peers outside Cloudflare's published
   ranges** (`@direct`), so a forged `CF-Connecting-IP` is dropped and the app falls back to
   the address you are actually connecting from. Forgery stops working. Nothing to do beyond
   keeping the range list current — the preflight in §3½ compares it against Cloudflare's
   published lists and names anything missing.

2. **Refuse the connection.** Uncomment `abort @direct` in `infra/Caddyfile` and reload
   (`docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`). Do it with SSH
   already open, and only once `TRUSTED_PROXY=cloudflare` is true — with `xff` it refuses
   every real visitor.

   Caddy can only refuse a packet that reaches Caddy, so back it with the host firewall,
   which is the layer that also absorbs a flood:

   ```sh
   # Cloudflare only, on 443. Refresh the list when Cloudflare publishes a change.
   for cidr in $(curl -s https://www.cloudflare.com/ips-v4); do
     ufw allow proto tcp from "$cidr" to any port 443
   done
   for cidr in $(curl -s https://www.cloudflare.com/ips-v6); do
     ufw allow proto tcp from "$cidr" to any port 443
   done
   ufw deny 443/tcp     # and keep your SSH rule above this
   ufw enable
   ```

   Cloudflare's **Authenticated Origin Pulls** (SSL/TLS → Origin Server) is the belt to that
   pair of braces: the edge presents a client certificate and Caddy refuses connections
   without it, which keeps working when the IP list moves.

**Check it from somewhere else**, not from the server: `curl --resolve palscans.org:443:<your
server IP> https://palscans.org/ -H 'CF-Connecting-IP: 1.2.3.4'`. Before the lockdown it
answers; after it, it does not. Until it does not, treat the panel IP allowlist and every
per-IP rate limit as advisory.

### Building on a small box

The image builds on the server, and `next build` type-checks after it compiles. tsc holds the
whole program graph in memory, and **V8 sizes its default heap ceiling from the host's RAM** —
on a 2 GB machine that lands near 1 GB, which this repo exceeds. The build then dies like this,
which is confusing because the hard part already succeeded:

```
✓ Compiled successfully in 2.4min
  Running TypeScript ...
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

That ceiling is V8's own, not the operating system's, so **adding swap does not fix it** — swap
is what stops the *kernel* killing you, and nothing here asked the kernel. `infra/Dockerfile`
raises it explicitly (`NODE_BUILD_MEMORY`, default 3072 MB) in the build stage only; no runtime
process is handed that heap. On a box with less than about 6 GB of RAM plus swap combined, lower
it:

```sh
dc build --build-arg NODE_BUILD_MEMORY=2048 web
```

Swap is still worth having on a small box — the compile phase before this one is genuinely
memory-hungry, and 4 GB is enough:

```sh
fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Set `WEB_CONCURRENCY=1`, `WORKER_CONCURRENCY=1` and `WORKER_PAGE_CONCURRENCY=1` on a single-core
box. That last one defaults to **4** — four pages decoded and AVIF-encoded at once, which on one
core buys nothing and on 2 GB is an out-of-memory kill waiting for a release day.

### One process per core

There is one more line you may want, and the default is already right:

```sh
# WEB_CONCURRENCY=auto     # unset or `auto` = one web process per core. Leave it alone.
```

`next start` is **one Node process**, and React server rendering is synchronous work on its
event loop. `docs/20-performance.md` measured what that costs: ~30 ms of CPU per reader page,
so **one process tops out at ~30 pages a second** — and throughput did not move at all between
one concurrent reader and thirty-two, at 1.07 of the box's 4 cores busy. Three cores sat idle.

So `pnpm start` and the `web` container now run `apps/web/scripts/serve.mjs`, which is
`next start` once per core behind Node's `cluster` module: **one container, one port, one
process to signal**, `reverse_proxy web:3000` unchanged, the same `/api/health` check, and one
`docker compose exec web`. On this 4-core box that took the reader from ~32 to ~90–110 pages a
second. Ctrl-C and `docker stop` still take the whole thing down: the primary forwards the
signal and each worker does the graceful drain `next start` already implements.

Set `WEB_CONCURRENCY` only to size *down* — each worker is a full Next server at roughly
200–250 MB, so a 2 GB machine wants `WEB_CONCURRENCY=2`. `WEB_CONCURRENCY=1` is the old
single-process behaviour. Anything that is not a positive integer or `auto` is refused at
startup rather than quietly serving on one core.

**The worker is not clustered and must not be.** It holds the publish scheduler, the stats
rollup and the nightly backup on interval timers; N copies would run each of them N times.
`WORKER_CONCURRENCY` gives it more jobs in flight inside the one process.

Two things change because each web process has its own memory, and both are worth knowing
before you see them:

- **A setting saved in the panel reaches the other web processes within 30 seconds**, not
  instantly — the credentials/settings memo is per process and the TTL is the invalidation
  (docs/19). Save an integration, reload, and the reload may land on a worker that has not
  re-read yet. The staff sign-in path and the panel IP allowlist come from a 60-second
  snapshot and behave the same way. Nothing is served *wrong*; it is late, briefly.
- **The view buffer is per process**, so beacons are batched N ways. Counting stays honest
  because the dedupe claim is in Redis and `view_events`' primary key is the final word —
  which is one of several reasons `REDIS_URL` is not optional here (§4).

And one thing to size rather than know: **the database connection pool is per process too**
(`DATABASE_POOL_MAX`, default 10), so the web tier wants `WEB_CONCURRENCY × 10` connections
and the worker another 10. The compose Postgres allows 100, which is comfortable on the 4-core
box in §0 and tight on an 8-core one. Getting it wrong does not fail at boot: it fails as
`FATAL: sorry, too many clients already` on whichever request needs a connection during your
first spike. The preflight in §3½ does the arithmetic for you.

---

## 3½ · Preflight: check it before you boot it

Everything above can be got wrong quietly. Before the first `up -d`, run the preflight — it
reads the `.env` you just wrote, connects to the services the app will connect to, and prints
a numbered list of what is not ready:

```sh
dc='docker compose --env-file .env -f infra/docker-compose.yml'
$dc up -d postgres valkey                      # the app itself is still down
$dc build web                                  # only needed the first time
$dc run --rm --no-deps -w /repo web node apps/web/scripts/preflight.mjs --host palscans.org
```

Run it **in the image**, as above, rather than on the host: the container is on the compose
network, so the `postgres:5432` and `valkey:6379` hostnames in your `.env` resolve to the
services you just started — from the host they do not resolve at all, and you would be
debugging the preflight instead of the deployment. (It will run on the host if you prefer —
Node 22 and `pnpm install` in the checkout is all it needs, no build step — but then point
`DATABASE_URL` and `REDIS_URL` at `127.0.0.1`, which is where compose publishes them.)

It exits non-zero if anything is blocking, and every failure says what to do rather than only
what is wrong. What it checks:

| | |
| --- | --- |
| `SESSION_SECRET`, `INTERNAL_API_SECRET`, `CREDENTIALS_KEY` | present, long enough, high enough entropy, all different — and **not a literal `$(openssl …)`**, which is 26 characters that clear the sealing key's 16-character floor in silence (the trap above) |
| `DATABASE_URL` | set, `postgres://` rather than PGlite, not carrying a well-known password |
| `SITE_URL` | `https://`, no trailing path, matches `--host`, and the name resolves |
| `TRUSTED_PROXY` | `xff` or `cloudflare`, never left at `none` |
| **Origin lockdown** (`cloudflare` only) | `infra/Caddyfile` deletes `CF-Connecting-IP` from peers outside Cloudflare's ranges; whether `abort @direct` is on; and whether Cloudflare has published ranges the file does not list |
| `WEB_CONCURRENCY` | a number or `auto` |
| Database | reachable; **every migration applied**, none pending and none edited after the fact |
| Connection budget | `WEB_CONCURRENCY × DATABASE_POOL_MAX` + the worker's pool fits inside `max_connections` |
| `pg_dump` / `pg_restore` | on `PATH` and not older than the server |
| Redis / Valkey | reachable, and `maxmemory-policy` is `noeviction` so BullMQ jobs cannot be evicted |
| Storage | driver is `s3` not `fs`, the four S3 values are set, and the bucket answers (`--write` also does the panel's write/read/delete round trip) |
| **Buckets** | the vault and the image backup bucket are set, and the three are genuinely three different buckets — the failure every individual read/write test still reports as working |
| **Backups** | `BACKUP_S3_BUCKET` is **not** the bucket the public hostname serves, and has a key that can write to it |
| **CDN exposure** | `<image host>/uploads/<missing key>` answers **403**, not 404 — the §2 check, automated. A failure with no vault configured; a warning with one, since nothing private is in that bucket |
| Admin | an account holds the `admin` role **and** has TOTP enrolled |
| Stored credentials | if `app_credentials` has rows, the current sealing key actually opens them (docs/19's silent-restore trap) |

Add `--offline` to skip everything that needs the network (DNS, the bucket, the CDN probe)
when you are checking a box before its DNS exists — and re-run it without the flag afterwards.
It reads and reports only: it never writes a setting and never fixes anything.

Re-run it after §5 and §6, when the admin account exists and the credentials are in the panel.

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

1. **Storage** — driver *S3 / Cloudflare R2*, then the endpoint, image bucket, access key ID,
   secret and region (`auto` for R2), and the public image URL (`https://palimages.org`).
   Then the **vault bucket** and the **image backup bucket** from §2 — each needs only its
   name if it is in the same R2 account; fill in an endpoint and key only to put one in a
   different account, which is worth doing for the mirror.

   Press **Test**: it writes a small object to each configured bucket, reads it back, compares
   the bytes and deletes it — and then checks the three names are three different buckets,
   which is the mistake every individual round trip reports as working perfectly. Save.
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

- [ ] `/` renders; covers load from your image host, not the app host
- [ ] **the §2 bucket check passes**: `<image host>/uploads/probe` answers **403**, not 200.
      A 404 is survivable once the vault exists — nothing private is in that bucket — but it
      means the WAF rule is not matching, so fix it anyway.
- [ ] **Admin → System → Integrations → Storage** → **Test** is green, including
      *Buckets are separate*. Three names that are secretly one bucket is invisible otherwise.
- [ ] the worker log shows no `object mirror is behind` line after an hour, or shows one that
      is shrinking — the first sweep of an existing catalogue has everything to copy
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
- [ ] `node apps/web/scripts/preflight.mjs --host palscans.org` exits **0** — run it again now
      that the admin account exists and the credentials are in the panel (§3½)
- [ ] you have read `docs/20-performance.md` and know what this box does per second, and
      `docker compose --env-file .env -f infra/docker-compose.yml exec web sh -c 'ps -o pid,args'`
      shows one `next-server` per core, not one in total

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
  With `WEB_CONCURRENCY` above 1 that now includes the other web processes, so a saved setting
  can look like it did not take for up to 30 seconds depending on which worker answers the
  reload (§3). `docker compose restart web` is the impatient version.
- **`CREDENTIALS_KEY` has no re-key command.** Rotating it means re-entering the credentials
  in the panel.
- **Deleting a reader's preference rows is a hard delete** (bookmarks, ratings, reactions,
  history). Everything else is soft-deleted and recoverable.
