# PALScans

PALScans — a bespoke manhwa / manga / manhua reading platform: public reader front end, full content admin
panel, image pipeline, subscriptions, and a migration path off the existing WordPress site
site.

## Status

Design phase. No application code yet — `docs/` is the specification the build follows.

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

## Non-negotiables

1. Authorization is computed once, on the server. The client renders; it never decides.
2. Locked content is never sent to a client that may not read it.
3. Image bytes never pass through the application server.
4. Every destructive admin action writes an audit row.
5. Nothing is hard-deleted.
