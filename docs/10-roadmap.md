# 10 — Build roadmap

Sized for one full-time developer. Two developers compresses this to roughly 8 weeks by
splitting admin work from public-site work after Phase 1. The old WordPress site stays live and
earning throughout.

## Phase 0 — Foundations (week 1)

Monorepo (pnpm workspaces + Turborepo), Next.js 15 app, Drizzle schema and first migration,
Docker Compose for Postgres/Valkey/MinIO/Mailpit, seed script generating ~200 fake series
with real cover images, CI (lint, typecheck, test, build), design tokens and the base
component set from `05-design-system.md`.

**Done when:** `pnpm dev` gives a running site against a seeded database, and CI is green.

## Phase 1 — Content spine (weeks 2–4)

Auth end to end (register, verify, login, forgot/reset, Google OAuth, sessions page).
Permission layer and admin shell. Series CRUD with cover/banner upload and cropping. Chapter
CRUD. **The image pipeline**: presigned uploads, the worker, variants, dimensions, BlurHash.
The bulk uploader with reorderable thumbnails. The reader, good enough to read a chapter
comfortably on a phone.

**In parallel, week 2: write the legacy-site importer.** It runs against live data from here on.

**Done when:** you can upload a 40-page chapter from a folder and read it on a phone.

## Phase 2 — The public site (weeks 5–6)

Home with hero, rails, latest updates, popular sidebar. Browse with filters and Postgres
full-text plus trigram search. Series page complete. Genre landing pages. Bookmarks,
reading progress, continue-reading. Ratings. Full SEO: metadata, JSON-LD, sitemaps, robots.
Lighthouse CI wired to the budgets in `06-frontend-and-reader.md`.

**Done when:** the site is fully usable as a reader and passes the performance budgets.

## Phase 3 — Community and operations (weeks 7–8)

Comments with structured rich text, reactions, and threading. Reports queue and the
moderation surface. User management. Notifications (in-app plus email for new chapters on
bookmarked series). Announcements. Audit log. Chapter scheduling and the publish worker.

**Done when:** a moderator can run the site for a day without a developer.

## Phase 4 — Monetization (weeks 9–10)

Stripe Checkout and Customer Portal. Webhooks writing subscriptions and entitlements
idempotently. Premium gating: early access windows, signed page URLs, the subscribe page,
billing support tickets. Promo codes and admin grants.

**Done when:** a real card completes a real subscription and unlocks a real early-access
chapter.

## Phase 5 — Polish and cutover (weeks 11–12)

PWA with the service worker and offline downloads. Discord OAuth and the notification bot.
Full accessibility pass. Load test the reader path. Restore-test the backups. Then run the
cutover sequence in `09-legacy-site-migration.md`.

**Done when:** DNS points at the new stack, legacy URLs 301 correctly, and Search Console is
stable.

## Explicitly deferred

Not in v1, and the schema is shaped so none of them require a migration later:

- **Novels vertical.** `series_type` already has `'novel'`; ship it once the comics side is
  stable rather than carrying two half-finished content modes like the site you're modelling.
- **Shard / consumable currency.** See `07-auth-and-monetization.md`.
- **Native mobile apps.** The PWA covers this until the numbers justify React Native.
- **Recommendation ML.** "Same genres, high rating, not yet read" ranks well enough for a
  long time.
- **Elasticsearch.** Postgres full-text plus `pg_trgm` is fine past 100k series.

## Order-of-work principles

1. **The reader is the product.** It gets built early and stays fastest.
2. **Admin before polish.** If uploading a chapter is painful, the catalog stops growing and
   nothing else matters.
3. **The importer is written in week 2.** An importer written at the end is run once, under
   pressure, at the moment it must not fail.
4. **Performance budgets in CI from Phase 0.** Cheap to hold, expensive to recover.
5. **Ship behind flags.** `feature_flags` lets a half-finished vertical sit in production
   safely.
