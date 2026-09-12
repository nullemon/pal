# 08 — Infrastructure, deployment, and cost

## Topology

```
                    Cloudflare (DNS, CDN, WAF, bot mitigation, Web Analytics)
                     │
        ┌────────────┴──────────────┐
        │                           │
   palscans.org                   palimages.org
   (Caddy → Next.js)         (R2 image bucket, immutable cache)
        │                           ▲
        │                           │ browser PUTs straight to a presigned URL
   ┌────┴──────┬───────────┬──────────────┐
 Next.js     Worker      Postgres 16    Redis / Valkey
 (2 procs)  (BullMQ)    (+ PgBouncer)
        │
        └── vault (R2, no hostname) ── mirror (R2, no hostname)
```

Everything except R2 and Cloudflare runs from one `docker-compose.yml` on a single machine
until traffic forces otherwise. Distributed systems bought before they are needed are the
most common way a project like this dies.

## Object storage

Four R2 buckets. Only one of them has a hostname, and that is the design rather than an
accident of setup.

| Bucket | Holds | Custom domain |
| --- | --- | --- |
| image | `covers/` `banners/` `pages/` `avatars/` `brand/` | **yes** — `palimages.org` |
| vault | `uploads/` (raw originals), `sitemaps/`, `_healthcheck/` | never |
| image backup | a verified copy of everything durable | never |
| database backup | nightly `pg_dump` archives | never |

R2 has no bucket policies and no per-prefix ACL: **public access is all-or-nothing per
bucket**, and connecting a custom domain turns it on for every object in it. Page images need
a public hostname; the raw originals must not have one. Those two requirements cannot both be
met inside one bucket, and the separation — not a WAF rule — is what settles it.
`packages/core/src/storage/profiles.ts` is the routing table and the security boundary; it is
default-deny, so a prefix nobody has thought about lands in the bucket with no address.

Reader traffic never touches the origin, and neither does an upload: the admin panel unzips a
CBZ **in the browser** and PUTs each image straight to a presigned URL, so the only bytes the
server handles are the worker's re-encode pass.

### The mirror

**R2 has no object versioning** — `GetBucketVersioning` and `PutBucketVersioning` are both on
Cloudflare's unimplemented list — so a deleted or corrupted object has nowhere to come back
from unless something copied it first. Every durable object is mirrored into a bucket with
different credentials, by two paths that cover different gaps:

- **write time**, for everything the app and worker produce;
- **an hourly reconcile sweep**, for the originals the browser uploaded directly, which no
  `put` in any of our processes ever sees. Two listings and a set difference, so it stays
  cheap at fifty thousand pages, and it doubles as the repair path for a dropped job.

Each copy is size-verified after writing — a truncated copy looks exactly like a good one
until the day you need it. Deletes are **not** propagated: surviving an accidental delete is
most of what a mirror is for. `restoreFromBackup()` puts an object back when it is missing or
its size no longer matches.

## Environments

- **local** — compose with Postgres, Valkey, MinIO (S3-compatible, stands in for R2), and
  Mailpit. `pnpm dev` brings the whole thing up; a seed script loads ~200 fake series so the
  UI is never developed against an empty database.
- **staging** — a small VPS, a nightly anonymised production restore, and the same image tag
  that will ship to production.
- **production** — see sizing below.

## Sizing and cost

Image bandwidth is free on R2, so the cost curve is driven by CPU and Postgres, which is a
much flatter curve than bandwidth.

**Launch — up to ~500k chapter reads/month**

| Item | Spec | Monthly |
|---|---|---|
| App VPS | 4 vCPU / 8 GB (Hetzner CPX31 class) | ~$18 |
| Postgres | on the same box, or a $20 managed instance | $0–20 |
| R2 storage | 500 GB | ~$8 |
| R2 egress | — | **$0** |
| Cloudflare | Free plan | $0 |
| Email | Resend free tier | $0 |
| Domain | | ~$1 |
| | **Total** | **≈ $30–50/mo** |

**Growth — ~10M chapter reads/month**

| Item | Spec | Monthly |
|---|---|---|
| App | 2× 8 vCPU / 16 GB behind Caddy | ~$70 |
| Worker | 4 vCPU / 8 GB | ~$18 |
| Postgres | managed 4 vCPU / 16 GB with a read replica | ~$120 |
| Redis | managed 1 GB | ~$15 |
| R2 storage | 5 TB | ~$75 |
| R2 egress | ~80 TB | **$0** |
| Cloudflare Pro | | $25 |
| Email + Stripe fees | | ~$30 + 2.9% |
| | **Total** | **≈ $350/mo** |

For comparison, that 80 TB of egress on standard cloud pricing is roughly **$7,200/month**.
The storage decision is worth more than every other optimisation in this document combined.

## Deployment

GitHub Actions:

```
lint + typecheck + unit tests        (every push)
build docker images                  (main)
run migrations                       (expand-only, before the new image starts)
deploy: start new containers, health check, drain old   (zero downtime)
lighthouse CI against staging        (fails on budget regression)
```

**Migrations are expand-contract.** Add a nullable column, backfill, start writing to both,
switch reads, drop the old column in a *later* release. Never a destructive migration in the
same deploy as the code that depends on it — that combination has no rollback.

**Asset caching.** Asura ships a global `error` handler that reloads the page when an
`/_astro/*` chunk 404s, and a Safari `pageshow` handler that reloads when a Tailwind sentinel
property is missing. Both are workarounds for old clients requesting retired hashed assets
after a deploy. Avoid the disease rather than treating it: keep the previous two builds'
assets served, and give the client a build-id endpoint it can poll to offer a "new version
available" refresh instead of reloading underneath the user.

## Backups and recovery

- Postgres: WAL archiving to R2 with point-in-time recovery, plus a nightly `pg_dump`
  retained 30 days. **Restore-test monthly** into staging and time it. A backup you have
  never restored is a hypothesis.
- R2: **no object versioning exists** — Cloudflare has not implemented it, so there is no
  undelete and no lifecycle rule to configure. The application's own object mirror above is
  the entire recovery story for images; an earlier version of this document assumed
  versioning and the runbook's object restore depended on it.
- Documented targets: RPO 5 minutes, RTO 1 hour, with the runbook in `infra/RUNBOOK.md`.

## Observability

- **Errors:** Sentry, client and server, with source maps and release tagging.
- **Metrics:** OpenTelemetry → Grafana Cloud free tier. The four that matter: p95 latency on
  the reader route, image-job queue depth, Postgres connection saturation, 5xx rate.
- **Logs:** structured JSON, correlation id per request, shipped to Loki. Never log tokens,
  emails, or raw IPs — hash IPs at the edge of the logger.
- **Alerts (page a human):** 5xx > 1% for 5 min · queue depth > 500 · replication lag > 30s
  · disk > 85% · Stripe webhook failures > 3 in 10 min.
- **Uptime:** external checks on `/`, a series page, and `/api/health` from three regions.

## Security baseline

- CSP with nonces, no `unsafe-inline`. This is much easier to adopt on day one than to
  retrofit at month six.

  **What shipped, and why it is not that.** `apps/web/lib/security/csp.ts`, sent by
  `next.config.ts` on every HTML response. A nonce has to be minted per request and read in
  the root layout, and a route that reads a request header cannot be prerendered — so nonces
  would turn `/terms`, `/privacy`, `/genres`, `/announcements`, `/contact`, `/dmca` and
  `/rankings/*` dynamic, against the whole rendering strategy in docs/06. It would not even
  remove `'unsafe-inline'`: Next writes the RSC flight payload into the prerendered HTML as
  inline `<script>` at build time, before any request exists — the prerendered `/terms`
  carries five executable inline scripts — and hashes move with the page's data.

  So `script-src` carries `'unsafe-inline'` and the policy does not claim to stop XSS. It
  does carry `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `frame-ancestors 'self'` and a scheme restriction on every fetch directive — none of which
  need a nonce, and all of which close something real. The public site additionally allows
  `https:` script because operator snippets (docs/15 "Advanced") and ad tags (docs/11) *are*
  third-party script; `/admin` gets a second, strict policy with no third-party origin at
  all. The route to something tighter is a `Content-Security-Policy-Report-Only` pass in
  production to learn what a real deployment loads — not a host list written from a guess.
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying
  everything unused.
- Uploads: magic-byte type sniffing (never trust the extension or the declared MIME), size
  caps, re-encode everything through `sharp` so no original bytes are ever served back.
- Dependabot plus `pnpm audit` in CI.
- Secrets in the platform's secret store, never in the repo. `.env.example` documents names
  and never values.
- Admin routes behind an additional check and, for `admin` role, mandatory TOTP.
