# 08 — Infrastructure, deployment, and cost

## Topology

```
                    Cloudflare (DNS, CDN, WAF, bot mitigation, Web Analytics)
                     │
        ┌────────────┴──────────────┐
        │                           │
   site.com                    cdn.site.com
   (Caddy → Next.js)           (R2 bucket, public prefix, immutable cache)
        │
   ┌────┴──────┬───────────┬──────────────┐
 Next.js     Worker      Postgres 16    Redis / Valkey
 (2 procs)  (BullMQ)    (+ PgBouncer)
```

Everything except R2 and Cloudflare runs from one `docker-compose.yml` on a single machine
until traffic forces otherwise. Distributed systems bought before they are needed are the
most common way a project like this dies.

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
- R2: object versioning on, lifecycle rule expiring noncurrent versions after 30 days.
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
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying
  everything unused.
- Uploads: magic-byte type sniffing (never trust the extension or the declared MIME), size
  caps, re-encode everything through `sharp` so no original bytes are ever served back.
- Dependabot plus `pnpm audit` in CI.
- Secrets in the platform's secret store, never in the repo. `.env.example` documents names
  and never values.
- Admin routes behind an additional check and, for `admin` role, mandatory TOTP.
