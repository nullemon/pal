# @palscans/web

The Next.js 16 app: public site, reader, admin, and API route handlers.

## Run locally

```sh
bash infra/dev-services.sh   # on a machine without Docker: local Postgres 16 + Redis
pnpm install                       # from the repo root
cp .env.example .env               # defaults: PGlite database, fs storage, no Redis
pnpm db:migrate
pnpm db:seed
pnpm dev                           # http://localhost:3000
```

The single `.env` lives at the repo root; `next.config.ts` loads it for this app. Point
`DATABASE_URL` at `postgres://pal:pal@127.0.0.1:5433/palscans` and set `REDIS_URL` to use
the local services instead of PGlite and the in-process queue.

Local files written by the `fs` storage driver (`STORAGE_FS_ROOT`, default `./.data/storage`
relative to the app's working directory) are served at `/_storage/<key>` by
`app/api/storage/[...path]/route.ts` via a rewrite.

## Scripts

| Script | What it does |
|---|---|
| `pnpm --filter @palscans/web dev` | Next dev server (Turbopack) |
| `… build` | production build |
| `… start` | serve: `scripts/serve.mjs`, i.e. `next start` once per core behind `node:cluster` on one port (`WEB_CONCURRENCY`; docs/20). `WEB_CONCURRENCY=1` runs it in this process with no supervisor |
| `… preflight` | `scripts/preflight.mjs` — the deployment checklist as a program (docs/18 §3½) |
| `… typecheck` | `next typegen` then `tsc --noEmit` |
| `… test` | vitest unit tests (`lib/**`) |
| `… e2e` | Playwright against `next start` on port 3100 (build first; `E2E_PORT` overrides). Screenshots land in `test-results/f1/` |

Playwright uses the preinstalled Chromium at `/opt/pw-browsers/chromium`; never run
`playwright install`.

## Layout

```
app/layout.tsx            html/body, fonts, <ThemeScript>; static — no cookies()/headers()
app/(site)/layout.tsx     public chrome: Header · main · Footer · BottomNav
app/(site)/page.tsx       home (placeholder until P1)
app/api/storage/          dev storage host for the fs driver
proxy.ts                  Next 16 middleware; storage-path guard today, P6 appends redirects
components/shell/         Header, Footer, FooterColumn, BottomNav, Wordmark, NavLinks,
                          SocialIcons, ThemeScript
lib/site.ts               nav + footer config (one place), labels from @palscans/core messages
lib/env.ts                zod-parsed environment
lib/theme.ts              THEME_COOKIE + resolveTheme() for dynamic pages only
```

Theme tokens are in `app/globals.css` (`@theme`, dark) with the light block under
`:root[data-theme="light"]`. Components use token utilities only (`bg-surface-1`,
`text-fg-muted`, `text-brand`, `font-display`, `shadow-2`…) — no literal colours or
arbitrary `shadow-[...]` values, so the docs/15 Appearance resolver can retheme everything.

## Deviations (F1)

- `/` — placeholder, not `design/mockups/A/Main.dc.html`: a single featured hero, the
  leaderboard slot, a Trending rail, a 2-column Latest updates grid and a Popular sidebar with
  the MPU. No carousel, pinned glow, sponsored card, popular tabs or announcements; P1 builds
  the real layout A. The hero synopsis is sample text in `page.tsx`, and `SeriesCard` /
  `page.tsx` render the chapter pill as `Ch. {n}` (no message key yet — P1 may append one to
  `packages/core/src/messages.ts`).
- Footer vs docs/11 — matches: brand + Browse · Account · Legal (four desktop columns),
  Discord button and social row beneath the grid, accordion below `md`. Deliberate deviation:
  five social icons (X · Instagram · Reddit · YouTube · Facebook) per docs/16; the RSS icon
  from docs/11 is left for P6, which owns `/feed`.
- Mobile bottom nav labels are Home · Browse · Bookmarks · Profile (message keys
  `nav.bookmarks` / `account.profile`; there is no "Library" key).

## Manifest / decisions

Files: `app/{layout,globals.css}`, `app/(site)/{layout,page}.tsx`,
`app/api/storage/[...path]/route.ts`, `proxy.ts`, `components/shell/*`, `lib/{env,site,theme,sample-catalog}.ts`
(+ tests), `e2e/home.spec.ts`, `playwright.config.ts`, `vitest.config.ts`, `next.config.ts`,
`postcss.config.mjs`, `public/dev-covers/*`.

Decisions the next agents depend on:

- **Theme**: the server always emits `<html data-theme="dark">` and never reads cookies in the
  root layout (that would make every route dynamic; docs/06 wants `/` static + ISR pages).
  `components/shell/ThemeScript.tsx` runs inline before paint and sets
  `document.documentElement.dataset.theme` from the `theme` cookie (`dark` | `light`), falling
  back to `prefers-color-scheme` (docs/05). P4's settings action writes the cookie with
  `THEME_COOKIE` from `lib/theme.ts`; `resolveTheme()` is only for dynamic pages
  (`/me/*`, `/admin/*`). Keep `suppressHydrationWarning` on `<html>`.
- **Static shell**: `app/layout.tsx` and `app/(site)/layout.tsx` are append-only and must stay
  free of `cookies()`, `headers()` and uncached data. `next build` must keep printing `○ /`.
- **UI copy**: import `{ messages, fmt } from '@palscans/core/messages'` — the subpath, not
  the package root. The root barrel re-exports the queue/storage modules and drags BullMQ into
  any client bundle that imports it (`lib/site.ts` is used by the client `BottomNav`).
  `packages/ui` does the same; `Chip`, `ChapterRow`, `Sheet`, `Toast`, `AdSlot`,
  `RatingStars`, `SeriesCard` read their labels from `messages`.
- **Storage host**: `/_storage/:path*` rewrites to `/api/storage/:path*` (`next.config.ts`),
  which serves files only when `STORAGE_DRIVER=fs`, validates segments with zod, and answers
  every failure with `{ error: 'not_found' }` (404). `proxy.ts` short-circuits paths whose
  percent-encoding cannot be decoded (Next would otherwise 500). The `fs` driver in
  `@palscans/core/storage` should produce public URLs of the form `/_storage/<key>`.
- **Ads**: `AdSlot` lives in `packages/ui` and takes a `noAds` boolean; callers derive it
  server-side from `entitlement(user, 'no_ads')` in `@palscans/core` (docs/11) — the
  component itself never decides access. Slot ids and sizes are the docs/11 table.
- **packages/ui** exports TypeScript source (`src/index.ts`); this app compiles it through
  `transpilePackages: ['@palscans/ui']` and Tailwind scans it via
  `@source "../../../packages/ui/src"` in `globals.css`. New shared components need nothing
  else. Client components in ui (`Sheet`, `Toast`, `RelativeTime`) start with `'use client'`.
- **Playwright**: `playwright.config.ts` starts `next start -p 3100` (override with
  `E2E_PORT`), reuses a running server outside CI, and writes screenshots to
  `test-results/<agent>/`. Build before running `e2e`. `use.colorScheme` is pinned to
  `dark` because ThemeScript follows `prefers-color-scheme` when no cookie is set (Playwright
  defaults to light); set `colorScheme: 'light'` in a test to screenshot the light theme.
- **Proxy**: `proxy.ts` is a shared file; append matchers rather than replacing the list, so
  `/` and the ISR pages are never routed through it.
