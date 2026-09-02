# 16 — Build plan

The contract every build agent works from. Read it in full before writing code. Where this
document and another doc disagree, this one wins for *how* to build; the numbered docs win
for *what* to build.

## Decisions (final)

| | Choice |
|---|---|
| Layouts | Home = direction **A · Violet Classic**, series = **B · Violet Refined**, reader = **long strip** default with the paged mode as an option; settings sheet on desktop and mobile. Mockups in `design/mockups/`. |
| Framework | **Next.js 16** (App Router, React 19, Turbopack), TypeScript strict |
| Styling | **Tailwind CSS v4** (CSS-first `@theme`), tokens from `05-design-system.md` with the A/B palette (below); no literal colours in components |
| Fonts | `@fontsource-variable/archivo` (display, 800, uppercase section titles) + `@fontsource-variable/plus-jakarta-sans` (body). Self-hosted from npm — no font proxy, no network at build |
| Icons | `lucide-react` |
| DB | PostgreSQL 16 with **Drizzle ORM** (`drizzle-orm`, `drizzle-kit`, `postgres` driver). Local fallback: **PGlite** (`@electric-sql/pglite` + `drizzle-orm/pglite`) when `DATABASE_URL` starts with `pglite://` |
| Cache / queue | `ioredis` + **BullMQ** when `REDIS_URL` is set; an in-process `MemoryQueue` / `MemoryCache` otherwise (same interface) |
| Storage | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` for R2 / MinIO / S3; `fs` driver for local (`STORAGE_DRIVER=fs`, files served at `/_storage/*` by a route handler in dev) — same `Storage` interface |
| Images | `sharp` in `apps/worker` |
| Auth | opaque server sessions in an HttpOnly cookie (`07-auth-and-monetization.md`), `@node-rs/argon2`, `arctic` for OAuth (Google, Discord) |
| Validation | `zod` for every input and for env parsing |
| Lint / format | **Biome** (root `biome.json`) |
| Tests | **vitest** (unit, packages), **Playwright** e2e in `apps/web` with `executablePath: '/opt/pw-browsers/chromium'` — never `playwright install` |
| Monorepo | pnpm workspaces + Turborepo (root files already exist) |

## Repo layout

```
apps/web            Next.js app: public site, admin, API route handlers
apps/worker         Node process: image pipeline, scheduled publishing, sitemaps, notifications
packages/db         Drizzle schema, migrations, db client (postgres | pglite), seed
packages/core       pure domain logic: permissions, entitlements, slugs, ranking, time, templates
packages/ui         shared React components (server-safe unless marked 'use client')
infra/              docker-compose.yml (prod-like), Caddyfile, RUNBOOK.md
design/             mockups, covers, page artwork used by the seed
docs/               the specification (00–16)
```

Package names: `@palscans/web`, `@palscans/worker`, `@palscans/db`, `@palscans/core`,
`@palscans/ui`. Each package has `build`, `typecheck`, `test` scripts (no-op where not
applicable) so Turborepo tasks resolve.

## Local environment (this machine)

- No Docker daemon. **Postgres 16 runs locally** on port **5433**: `postgres://pal:pal@127.0.0.1:5433/palscans`. Redis runs on 6379. Use them; keep the PGlite path working as well (`pnpm test` in `packages/db` must pass on PGlite so CI needs no service).
- Chromium at `/opt/pw-browsers/chromium`. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set.
- Outbound network goes through a proxy; the npm registry works, `fonts.googleapis.com` may not. Do not depend on network at build time beyond `pnpm install`.
- 4 CPUs. Keep `next build` and tests within that.

## Tokens (from the chosen A/B directions)

```css
@theme {
  --color-bg: #100d17;        --color-surface-1: #181423;  --color-surface-2: #1f1a2c;
  --color-surface-3: #26203a; --color-line: #2c2540;       --color-line-soft: #221d33;
  --color-fg: #ece9f4;        --color-fg-muted: #9e97b8;   --color-fg-subtle: #6f6890;
  --color-brand: #7c3aed;     --color-brand-hover: #8b5cf6; --color-brand-dim: #4c2a8f;
  --color-brand-wash: rgb(124 58 237 / 0.14); --color-brand-ink: #ffffff;
  --color-gold: #f5c451;      --color-ok: #22c55e;  --color-warn: #f59e0b;  --color-danger: #ef4444;
  --color-type-manhwa: #e5484d; --color-type-manhua: #12a594; --color-type-manga: #3b82f6; --color-type-comic: #a78bfa;
  --color-status-ongoing: #3b82f6; --color-status-completed: #22c55e; --color-status-hiatus: #f59e0b; --color-status-cancelled: #6f6890;
  --font-display: "Archivo Variable", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Plus Jakarta Sans Variable", ui-sans-serif, system-ui, sans-serif;
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 14px;
}
```

The light theme is the token block in `05-design-system.md`; both are emitted by the
appearance resolver (`15-appearance.md`) as CSS custom properties inlined in the shell, with
these values as the defaults. Tailwind utilities must reference `--color-*` tokens only.

## Conventions

- Server Components by default; `'use client'` only for interaction. Data access happens in
  server components and route handlers through `@palscans/db` query helpers — never in
  client components.
- **Authorization lives in `@palscans/core`** (`can`, `entitlement`, `canReadChapter`) and is
  called from `withPermission(...)` / `requireUser()` wrappers in route handlers and server
  actions. Client code never decides access.
- Locked chapters: page URLs are not rendered for a user who may not read them.
- Every mutating admin action writes `audit_log`. Nothing is hard-deleted (`deleted_at`).
- All UI copy goes through `packages/core/src/messages.ts` (plain English keys, one file).
- Relative times: render `<time datetime>` server-side, format client-side.
- Images: `<img>`/`next/image` with intrinsic `width`/`height` from the DB, lazy except LCP.
- Every route handler validates input with zod and returns `{ data }` or `{ error }`.
- No `any`. Biome must pass. `pnpm typecheck`, `pnpm test`, `pnpm build` must pass before
  an agent reports done.

## Phases and ownership

Agents work only inside the directories they own; shared files are listed per phase.

### Phase 0 — foundation (two agents in parallel)

**F1 · app foundation** — owns `apps/web`, `packages/ui`, `infra/`, `.github/`.
Next 16 app with Tailwind v4 and the tokens above (`app/globals.css`), fonts, root layout
with `Header` (logo · Home · Browse · Rankings · Genres · Bookmarks · search · bell ·
Premium · avatar), `Footer` (four columns, Join the Discord, five social icons, copyright,
per `11-ads-footer-community.md`), `BottomNav` (mobile), `AdSlot` component (reserved box
with label, hidden when `noAds`), theme attribute on `<html>`. `packages/ui`: `Button`,
`Chip`, `SeriesCard`, `ChapterRow`, `Rail`, `Sheet`, `Skeleton`, `Toast`, `EmptyState`,
`RatingStars`, `Avatar`. A placeholder home route that renders the shell with static
sample content so it can be looked at. `infra/docker-compose.yml` (postgres, valkey, minio,
mailpit, web, worker), `Caddyfile`, GitHub Actions workflow (lint, typecheck, test, build).
Playwright config + one smoke test that loads `/` and screenshots it.

**F2 · data foundation** — owns `packages/db`, `packages/core`.
Drizzle schema translating `02-data-model.md` plus the additions in `12-seo.md` §9,
`14-comments.md` §7, `15-appearance.md`, `13-everything-else.md` (groups, chapter_groups,
slug_history, redirects, push_subscriptions, notification_prefs, bans, webhooks, api_keys,
settings tables). Enums, indexes, soft deletes. `db/client.ts` choosing postgres or PGlite
from `DATABASE_URL`. `drizzle-kit generate` migrations committed. Query helpers for the
hot paths (home feed, series page, chapter pages, popular). **Seed**: genres, people, the 16
catalog series from `design/mockups/BRIEF.md` (exact titles, types, ratings, chapter
numbers) plus ~120 generated series, chapters with pages whose images are the files in
`design/pages/` (`page-c-*.svg` for manhwa strips, `page-m-*.svg` for manga) and covers
from `design/mockups/covers/`, copied into local storage; users `admin@palscans.org` /
`mod@`, `uploader@`, `premium@`, `reader@` (password `palscans-dev`), bookmarks, ratings,
comments, an announcement, default appearance and SEO settings. `packages/core`:
`permissions.ts` (from `04-admin-panel.md`), `entitlements.ts`, `access.ts`
(`canReadChapter`), `slug.ts`, `ranking.ts` (Bayesian), `time.ts`, `templates.ts` (SEO
template variables), `messages.ts`. vitest tests for core and a PGlite migration + seed
smoke test.

### Phase 1 — pages and systems (after Phase 0; parallel, disjoint directories)

| Agent | Owns | Builds |
|---|---|---|
| P1 home + discovery | `apps/web/app/(site)/{page,browse,genres,rankings,search}`, `apps/web/components/home/*` | Home = layout **A** exactly as `design/mockups/A/Main.dc.html` (hero carousel, leaderboard slot, trending rail, latest updates 2-col grid with pinned glow and sponsored card, popular sidebar with tabs, MPU, announcements), browse with filters incl. exclude, genre pages with intro copy, rankings, search (Postgres FTS + trigram), PPR/ISR per `06` |
| P2 series + comments | `apps/web/app/(site)/series/[slug]`, `components/series/*`, `components/comments/*`, `app/api/comments/*` | Series page = layout **B** (`design/mockups/B/SeriesB.dc.html`) with the comment system per `14-comments.md`: composer, sort, reactions, replies, spoilers, mentions, reports, block; submit pipeline with links held by default, word filters, automod score, rate limits |
| P3 reader | `apps/web/app/(site)/series/[slug]/chapter-[n]`, `components/reader/*`, `app/api/progress` | Long strip (default) + paged mode, settings sheet (mode · direction · fit · quality · preload · background), chrome auto-hide, keyboard, progress via sendBeacon, ad slots (skyscrapers, in-strip every N, end-of-chapter) driven by settings, locked-chapter gate |
| P4 auth + account | `apps/web/app/(auth)/*`, `app/(site)/me/*`, `app/api/auth/*`, `lib/auth/*` | Register/verify/login/forgot/reset, Google + Discord OAuth via arctic, sessions table + cookie, rate limits, sessions page, bookmarks/history/settings pages, entitlements read |
| P5 admin + pipeline | `apps/web/app/admin/*`, `app/api/admin/*`, `apps/worker/*`, `lib/storage/*` | Admin shell + Dashboard, Series/Chapter CRUD, bulk uploader (presigned PUT → storage; fs driver locally), worker `chapter.process` with sharp (AVIF+WebP, 4 widths, dimensions, BlurHash), scheduling worker, moderation queue (Pending · Reported · Flagged), users, audit log, **Appearance → Layouts and Theme** screens per the mockups with the token resolver, Ads settings |
| P6 seo + settings | `apps/web/lib/seo/*`, `app/sitemap*`, `app/feed*`, `app/robots.txt`, `app/api/admin/seo/*` | Metadata templates, JSON-LD builders, sitemap index + child files with incremental rebuild, IndexNow, RSS/Atom, robots, redirects middleware, slug history 301s, Admin → SEO screen |

Shared files in Phase 1 (edit with care, append only): `apps/web/app/layout.tsx`,
`packages/core/src/messages.ts`, `packages/db/src/schema/*` (add columns via a new migration,
never rewrite others' tables).

### Phase 2 — integration

One agent runs the whole thing: `pnpm install`, `db:migrate`, `db:seed`, `pnpm build`,
Playwright smoke across `/`, a series page, a chapter, `/admin`, `/login`; screenshots to
`apps/web/test-results/`; fixes what breaks; reports what remains.

## Definition of done, per agent

1. `pnpm --filter <pkg> typecheck`, `test`, and `build` pass.
2. Biome passes on your files.
3. For UI work: a Playwright screenshot of each page you built, saved under
   `apps/web/test-results/<agent>/`, and a one-line note per page on anything that deviates
   from its mockup.
4. A short manifest of files created and any decisions the next agent must know.
