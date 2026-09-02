# pal

A bespoke webcomic / manga reading platform: public reader front end, full content admin
panel, image pipeline, subscriptions, and a migration path off an existing WordPress+Madara
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

**Approach to the existing Madara site:** keep it live and earning, build the new platform
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
| [09 — Madara migration](docs/09-madara-migration.md) | Discovery, mapping, images, cutover, rollback |
| [10 — Roadmap](docs/10-roadmap.md) | 12 weeks, phase by phase |

## Non-negotiables

1. Authorization is computed once, on the server. The client renders; it never decides.
2. Locked content is never sent to a client that may not read it.
3. Image bytes never pass through the application server.
4. Every destructive admin action writes an audit row.
5. Nothing is hard-deleted.
