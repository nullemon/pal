# 01 — Architecture and stack decision

## The recommendation

**A single TypeScript monorepo: Next.js 15 (App Router) + PostgreSQL + Redis +
Cloudflare R2, with an out-of-process worker for image encoding.**

```
pal/
  apps/
    web/            Next.js 15 — public site, admin panel, and API routes
    worker/         Node process — image encoding, notifications, scheduled publishing
  packages/
    db/             Drizzle schema + migrations + query helpers
    core/           domain logic: permissions, entitlements, slugs, ranking
    ui/             shared React components + design tokens
  infra/
    docker-compose.yml, Caddyfile, migrations runner
```

### Why one language and one repo

The single biggest risk to a project this size is not performance — it is that a small team
never finishes it. Asura runs Astro *and* Go, which means two build systems, two deploy
pipelines, two sets of types for the same entities, and a hand-maintained contract between
them. That is a reasonable trade once you have a team and traffic. It is the wrong first
move.

One repo gives you: types flowing from the database schema through the API into the React
components with no codegen step; one auth implementation; one deploy; and an admin panel
that imports the same query helpers the public site uses.

### Why Next.js over Astro

Astro is genuinely excellent for the *public* half of this site — a reader page is mostly
static and Astro would ship less JavaScript. But this product is two applications glued
together, and the second one is a data-dense admin panel with drag-to-reorder page grids,
bulk upload queues, and live job status. That is an app, not a document.

Next.js 15 App Router closes most of Astro's gap: React Server Components render the series
and reader pages with essentially no client JavaScript, and Partial Prerendering serves a
cached shell with a dynamic hole for the personalised bits. You give up perhaps 10–15 KB of
JS on the reader page and get one codebase in return.

**Take the Astro + Go split instead if** you already have Go people, or you pass roughly
20M chapter views a month and the API becomes the bottleneck. The data model and image
pipeline in this design are framework-agnostic; the API can be lifted into Go later without
touching the schema.

### Component choices

| Concern | Choice | Reason |
|---|---|---|
| Database | PostgreSQL 16 | One engine covers relational data, full-text search (`tsvector` + `pg_trgm` trigram fuzzy match), JSONB for flexible metadata, and window functions for ranking. No Elasticsearch until well past 100k series. |
| ORM / query layer | Drizzle ORM | SQL-shaped, no runtime overhead, generates TypeScript types from the schema, real migrations. Prisma's engine binary and N+1 behaviour hurt on the read paths that matter here. |
| Cache / queue | Redis (Valkey) | Session lookup, rate limiting, hot-path caching of series and chapter lists, and BullMQ job queues for the image pipeline. |
| Object storage | **Cloudflare R2** | Zero egress fees. This is the single most consequential decision in the whole design — see below. |
| CDN | Cloudflare | Free tier caches images and HTML, gives you WAF, bot mitigation, and hotlink protection out of the box. |
| Image encoding | `sharp` (libvips) in the worker | Fast, low memory, AVIF + WebP output. |
| Auth | Server sessions, HttpOnly cookies, Argon2id | See `06-auth-roles-monetization.md`. Deliberately not the token model Asura uses. |
| Payments | Stripe Billing + webhooks | Subscriptions, proration, and a chargeback story that matters here. |
| Email | Resend or Postmark | Transactional only — verification, password reset, receipts. |
| Deploy | Docker Compose on a single VPS behind Caddy, or Vercel + Neon to start | See `07-infrastructure-and-cost.md`. |

### The egress argument for R2

A chapter is 25–40 images. At 250 KB each that is roughly **8 MB per chapter read**.

| Monthly chapter reads | Image egress | AWS S3 / most clouds @ $0.09/GB | Cloudflare R2 |
|---|---|---|---|
| 1M | ~8 TB | ~$720/mo | **$0** |
| 10M | ~80 TB | ~$7,200/mo | **$0** |
| 50M | ~400 TB | ~$36,000/mo | **$0** |

R2 charges for storage (~$0.015/GB-month) and operations, not for bandwidth out. With
Cloudflare's CDN in front, most requests never reach R2 at all. Every other decision in
this document is reversible; this one determines whether the site is affordable.

## Request paths

**Reading a chapter (the hot path).**
Cloudflare edge → cached HTML shell (60s, `stale-while-revalidate`) → RSC renders the page
list from Postgres → the browser requests images directly from `cdn.palscans.org`, which is
R2 behind Cloudflare with `Cache-Control: public, max-age=31536000, immutable`. The
application server never touches image bytes. Personalised elements (progress bar, bookmark
state, premium chrome) stream in through a dynamic hole so the shell stays shareable — the
same problem Asura solves with `opacity: 0`, solved without hiding the page.

**Publishing a chapter.**
Admin drags a folder or CBZ → browser requests presigned R2 upload URLs → files go
**directly** browser → R2, never through the app server → a `chapter.process` job is
enqueued → the worker decodes each page, strips EXIF, resizes to 480/720/1080/1440,
encodes AVIF + WebP, records intrinsic dimensions, writes content-addressed keys → the
chapter flips to `ready` → if `published_at` is in the future the scheduler publishes it
and fans out notifications.

Routing uploads through the app server is the classic mistake here: a 40-page chapter is a
300 MB multipart request that occupies a request handler for minutes. Presigned URLs make
uploads independent of your server's memory, timeouts, and deploy cycle.

## Non-negotiable invariants

1. **Authorization is computed once, on the server.** `can(user, 'chapter.publish')` and
   `entitlement(user, chapter)` live in `packages/core` and are called from route handlers.
   The client never decides what it may see; it only decides what to *render*.
2. **Locked content is never sent to the client.** A premium chapter's page URLs are not in
   the HTML for a non-entitled user. Signed, short-lived URLs for paid pages — a CSS blur
   over a real image URL is not a paywall.
3. **Image bytes never pass through the application server.** Upload via presigned PUT,
   serve via CDN.
4. **Every destructive admin action writes an audit row.** Who, what, before, after, when,
   from where.
5. **Nothing is hard-deleted.** `deleted_at` everywhere. Recovering a mistakenly deleted
   200-chapter series from a backup at 3am is not a plan.
