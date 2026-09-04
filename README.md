# PALScans

PALScans — a bespoke manhwa / manga / manhua reading platform: public reader front end, full content admin
panel, image pipeline, subscriptions, and a migration path off the existing WordPress site
site.

## Status

**Built and verified; not deployed anywhere yet.** The front end, reader, admin panel, image
pipeline, importer, comments and billing are implemented in `apps/` and `packages/`; `docs/`
is the specification the build followed, and stays the reference for *why* things are the way
they are.

Deployment has not been started because it needs things only the operator can obtain — a
server, the domain's DNS, and an R2 bucket. [docs/18 — Launch](docs/18-launch.md) is the
ordered list, and [infra/RUNBOOK.md](infra/RUNBOOK.md) is what to do after.

```sh
pnpm install
pnpm dev          # web on :3000, worker alongside it
pnpm test         # vitest across the workspace
pnpm typecheck && pnpm lint
```

## The short version

**Stack:** Next.js 15 (App Router) + TypeScript monorepo · PostgreSQL 16 + Drizzle ·
Redis/Valkey + BullMQ · Cloudflare R2 for object storage · Cloudflare CDN · Stripe Billing ·
`sharp` for image encoding, in an out-of-process worker.

**The decision that matters most:** images live in Cloudflare R2, which has **zero egress
fees**. At 10M chapter reads a month this is the difference between about $0 and about
$7,200 a month in bandwidth.

**Approach to the existing WordPress site:** keep it live and earning, build the new platform
beside it, write the importer in week 2, and cut over with 301s preserving every legacy URL.

## Documents

| | |
|---|---|
| [00 — Platform analysis](docs/00-platform-analysis.md) | What asurascans.com actually runs on, and what to learn from it |
| [01 — Architecture](docs/01-architecture.md) | Stack decision, request paths, invariants |
| [02 — Data model](docs/02-data-model.md) | PostgreSQL schema as DDL |
| [03 — Image pipeline](docs/03-image-pipeline.md) | Upload, encode, store, serve, protect |
| [04 — Admin panel](docs/04-admin-panel.md) | Permissions, bulk upload, scheduling, moderation |
| [05 — Design system](docs/05-design-system.md) | Tokens, typography, components, motion, a11y |
| [06 — Front end and reader](docs/06-frontend-and-reader.md) | Routes, rendering strategy, the reader, mobile |
| [07 — Auth and monetization](docs/07-auth-and-monetization.md) | Sessions, roles vs entitlements, Stripe, compliance |
| [08 — Infrastructure and cost](docs/08-infrastructure-and-cost.md) | Topology, sizing, deploys, backups, security |
| [09 — Legacy site migration](docs/09-legacy-site-migration.md) | Discovery, mapping, images, cutover, rollback |
| [10 — Roadmap](docs/10-roadmap.md) | 12 weeks, phase by phase |
| [11 — Ads, footer, community](docs/11-ads-footer-community.md) | Ad slot inventory and rules, footer map, Discord and socials |
| [12 — SEO](docs/12-seo.md) | URLs, metadata templates, rich SEO text, JSON-LD, sitemaps and feeds with admin controls, indexing rules |
| [13 — Everything else](docs/13-everything-else.md) | The completeness checklist: reader extras, discovery, scanlation credits, safety, accounts, notifications, money, site management, legal, hygiene |
| [14 — Comments](docs/14-comments.md) | Reactions, replies, spoilers, mentions, images, premium perks, and the moderation pipeline that holds links by default |
| [15 — Appearance](docs/15-appearance.md) | Accent colour and derived ramp, theme, typography, shape and density, layouts, header/footer/menus, reader defaults, copy, formatting, presets and history |
| [16 — Build plan](docs/16-build-plan.md) | The build contract: stack choices, repo layout, and the conventions every route, job and component follows |
| [17 — Remaining scope](docs/17-remaining-scope.md) | Billing, notifications, the importer and the rest of the second pass over docs 00–15 |
| [18 — Launch](docs/18-launch.md) | **Start here to deploy**: DNS, R2 and its WAF rule, the server, first boot, your admin account, credentials, backups |
| [19 — Credentials](docs/19-credentials.md) | Which secrets live in the admin panel, which cannot, how they are sealed, and what goes stale for how long |

Operational, not a design document: [infra/RUNBOOK.md](infra/RUNBOOK.md) — restore, rotate,
take down a title, roll back.

## Non-negotiables

1. Authorization is computed once, on the server. The client renders; it never decides.
2. Locked content is never sent to a client that may not read it.
3. Image bytes never pass through the application server.
4. Every destructive admin action writes an audit row.
5. Content is soft-deleted and recoverable — series, chapters, comments, users. (The two
   deliberate exceptions: a reader clearing their own preference rows, and objects you delete
   from R2 by hand.)
