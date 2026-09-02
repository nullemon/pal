# 06 — Public front end and reader

Mobile-first throughout. Assume 70–85% of sessions are phones on mid-range Android over
mobile data, because for this category they are.

## Route map

```
/                          home — hero, rails, latest updates, popular sidebar
/browse                    filterable catalog (genre, type, status, year, sort)
/series/[slug]             series detail
/series/[slug]/[chapter]   reader
/search                    full search results (modal on top of any page via ⌘K)
/rankings                  weekly / monthly / all-time
/genres/[slug]             genre landing (real pages — these rank in search)
/announcements[/slug]
/u/[username]              public profile
/me/bookmarks              tabs: reading, planned, completed, paused, dropped
/me/history                reading history
/me/settings               account, security, sessions, notifications
/subscribe                 plans
/login /register /forgot-password /reset-password /verify
/dmca /terms /privacy
```

## Rendering strategy

| Route | Strategy | Revalidate |
|---|---|---|
| `/` | static shell + dynamic personalised holes | 60s |
| `/series/[slug]` | ISR | 300s, on-demand purge on chapter publish |
| `/series/[slug]/[chapter]` | ISR | 3600s (immutable once published) |
| `/browse`, `/search` | dynamic, Redis-cached by query | 60s |
| `/me/*`, `/admin/*` | fully dynamic, `no-store` | — |

The personalisation problem Asura solves with `opacity: 0` is solved here with Partial
Prerendering: the cached shell contains skeletons where user-specific chrome goes
(bookmark state, continue-reading, premium badges), and those stream in from the server.
The page is readable at first paint whether or not the user is signed in, and whether or
not JavaScript runs.

## Home

- **Hero** — up to 12 featured series. Desktop: centred slide scales up with blurred cover
  as backdrop, autoplay 6s, pauses on hover and on `prefers-reduced-motion`. Mobile: a
  scroll-snap rail, no autoplay, no library.
- **Continue reading** — only rendered for signed-in users with progress; it is the highest
  value module on the page and belongs above trending.
- **Latest updates** — the primary module. Each row: cover, title, and the 3 most recent
  chapters with relative timestamps and read/unread state. Server-rendered, paginated with
  real `?page=` URLs (crawlable), infinite-scroll layered on top progressively.
- **Rails** — trending, new series, editor's picks.
- **Popular sidebar** — weekly/monthly/all-time tabs, top 10, numbered.
- **Announcements** — one compact card linking to the full page. Not a carousel of
  full-length HTML posts.

Relative timestamps are computed **client-side from a server-rendered ISO `datetime`
attribute** inside `<time>`. Rendering "6 days ago" on the server and caching it for an hour
is how you end up showing "Just now" on a day-old chapter.

## Series page

Banner backdrop (blurred cover fallback), cover with lightbox, title, alternative titles
collapsed behind a disclosure, type/status/year chips, author/artist links, genre chips.

Stat trio: rating (one decimal, with count), chapter count, bookmark count (compact
formatting: `81.3K`). Primary actions: **Read first** / **Continue from ch. N** (swaps based
on progress), **Bookmark**, **Rate**, **Download** (entitlement-gated), overflow menu with
Share and Report data mistake.

Synopsis clamps to 4 lines with "Show more"; on mobile the expansion is a bottom sheet.

Chapter list: sticky search + sort (newest/oldest) + "unread only" toggle. Each row shows
number, title, relative date, read state, and lock state. Locked rows show the unlock time
explicitly — "Free in 4h 12m" beats a bare padlock. Virtualised above 200 rows.

Below: linked-novel cross-sell card, comments, recommendations.

### SEO

Per page: canonical, OG/Twitter, and JSON-LD — `BreadcrumbList` plus `ComicSeries` with
`aggregateRating` (using the **real** rating count, not the bookmark count), `genre[]`,
`author`, `numberOfEpisodes`. Chapter pages add `ComicIssue`/`Article` and `rel="prev"` /
`rel="next"`. Site-wide: `Organization` and `WebSite` with `SearchAction`. Genre pages get
real indexable URLs with unique copy — this is where organic discovery actually comes from.

## The reader

The most important screen in the product. It should feel like nothing at all.

**Layout.** Single vertical column, `max-width: 820px`, pages stacked with zero gap. Every
`<img>` carries `width`/`height` from `chapter_pages`, so the full document height is known
before any image loads and the scrollbar never jumps.

**Loading.** First 3 pages eager with `fetchpriority="high"`; page 1 preloaded in the head.
The rest lazy with `rootMargin: 150%`. BlurHash placeholder underneath each box. When the
reader passes 80% of the chapter, prefetch the next chapter's first 3 pages and its data —
so "Next" is instant, which is what makes a binge feel good.

**Chrome.** Header and footer slide out on scroll-down, back on scroll-up, and toggle on tap
in the centre 60% of the viewport. Left and right 20% edge zones page backwards/forwards for
paged mode. A one-time hint pill teaches the tap gesture. Both bars respect
`env(safe-area-inset-*)`.

**Controls.** Prev / chapter dropdown (searchable full list) / Next in the footer. Keyboard:
`←`/`→` chapters, `space`/`shift+space` scroll, `f` fullscreen, `c` comments, `s` settings.

**Settings sheet**, persisted per device: reading mode (long strip · single page · double
page), image width (fit width · fit height · original · custom %), background (black ·
dark · sepia · white), gap between pages (0–24px), and preload depth.

**Progress.** An `IntersectionObserver` tracks the topmost visible page; progress is written
at most once every 5 seconds and once more on `visibilitychange` via `navigator.sendBeacon`.
Resume restores both chapter and scroll percentage.

**Offline** (entitlement-gated). A service worker caches a chapter's pages into the Cache API
with a manifest in IndexedDB; the bookmarks screen shows downloaded chapters with sizes and
a purge control. This is a real premium perk and it is also the single best reason for a
reader to install the PWA.

**Locked chapters.** The reader route checks entitlement server-side. A non-entitled user
gets a subscribe page carrying the series, cover, and chapter in the query string, so the
page can say what they were trying to read and return them there after paying. Page URLs are
never emitted for a chapter the user may not read.

## Mobile specifics

- Bottom tab bar below 768px: Home · Browse · Library · Profile. Hidden inside the reader.
- Every tap target ≥ 44px. Chapter rows are 56px tall — thumb-sized, not mouse-sized.
- `100dvh`, never `100vh` — mobile browser chrome makes `vh` wrong by exactly the height of
  the URL bar.
- `overscroll-behavior: contain` on sheets and the chapter dropdown so scrolling one doesn't
  scroll the page behind it.
- `touch-action: manipulation` site-wide to remove the 300ms tap delay.
- Pull-to-refresh disabled inside the reader only.
- PWA manifest with `display: standalone`, maskable icons, `theme-color` matched to
  `--color-bg`, and a share target so a shared link opens in the installed app.

## Performance budgets, enforced in CI

Lighthouse CI on `/`, `/series/[slug]`, and a reader page, on emulated mid-tier mobile,
failing the build on regression:

| Metric | Budget |
|---|---|
| LCP | ≤ 2.0s |
| CLS | ≤ 0.02 (the reader must be ~0) |
| INP | ≤ 150ms |
| First-party JS, reader route | ≤ 60 KB gzipped |
| First-party JS, home | ≤ 110 KB gzipped |

A budget nobody enforces is a wish. Wire it to the pipeline in week one, while hitting the
numbers is still free.
