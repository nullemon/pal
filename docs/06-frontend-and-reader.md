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

The most important screen in the product. Two modes, switchable from the settings sheet
and remembered per device; the site-wide default is an admin setting.

### Long strip

Every page of the chapter in one vertical column, `max-width: 820px` centred, pages
touching with zero gap and zero radius. Every `<img>` carries `width`/`height` from
`chapter_pages`, so the full document height is known before any image loads and the
scrollbar never jumps. First 3 pages eager with `fetchpriority="high"`, page 1 preloaded;
the rest lazy with `rootMargin: 150%` and a BlurHash placeholder underneath. At 80% of the
chapter the next chapter's first 3 pages and its data are prefetched, so "Next" is instant.

### Paged

One page at a time, the way cubari-style readers work: the current page fit-to-height on
desktop (fit-to-width on mobile), centred on the page colour, with only the pages around
it loaded — the current page plus a configurable preload of 3 / 5 / 10 ahead. Navigation:
click or tap the left / right 30% of the page, arrow keys, swipe on touch, and a chapter
select plus a page select in the top bar. A scrubber with one tick per page sits along the
bottom. Double-page spreads and **right-to-left** direction for manga are options of this
mode. A first-run overlay shows the three tap zones (Previous · Menu · Next) once.

Switching modes keeps your place: strip → paged opens on the page you were looking at,
and back.

### Chrome

Top bar: back, series title + chapter, page counter, settings, comments. Bottom bar:
Prev · chapter select · Next. Both slide out on scroll-down or on tap in the centre zone
and back on scroll-up; `H` toggles them on desktop, and in the hidden state a floating
glass pill carries Prev / chapter / Next. A 3px progress bar stays at the top in either
state. All bars respect `env(safe-area-inset-*)`.

Keyboard: `←`/`→` pages or chapters, `space`/`shift+space` scroll, `f` fullscreen,
`s` toggle strip/paged, `c` comments, `?` shortcut sheet.

### Settings sheet

Per device: **Mode** (long strip · single page · double page) · **Direction** (left-to-right
· right-to-left) · **Fit** (width · height · original) · **Quality** (auto · high · saver) ·
**Preload** (3 · 5 · 10) · **Background** (black · dark · sepia · white) · page gap for the
strip · and a "Remove ads and unlock early access" row that goes to Premium.

### Ads in the reader

Placements are fixed; whether each is on, and the mobile interval, are admin settings
(`04-admin-panel.md`, Appearance → Layouts):

| Placement | Size | Behaviour |
|---|---|---|
| Desktop skyscrapers | 160×600 (or 300×600) | one in each gutter beside the reading column, `position: sticky`, vertically centred; only when the viewport is wide enough that they never overlap the column (≥ 1280px for 160, ≥ 1520px for 300) |
| Mobile in-strip | 300×250 on a full-width band | after every **N** pages in long-strip mode, N = off / 2 / 4 / 6; in paged mode the same interval inserts an ad *page* between pages |
| End of chapter | 336×280 desktop / 300×250 mobile | after the last page, before the Next Chapter control, in both modes |

Every slot reserves its box before the ad loads, so nothing shifts under the reader's
thumb. `no_ads` entitlement (both Premium tiers) renders none of them — not a collapsed
box, nothing. The in-strip interval is the most sensitive lever on the site: it earns
the most per reader and it is the reason readers reach for ad blockers, so it is a
setting with a live preview rather than a constant, and the default is 4.

### Progress and offline

An `IntersectionObserver` (strip) or the page index (paged) tracks position; progress is
written at most once every 5 seconds and once more on `visibilitychange` via
`navigator.sendBeacon`. Resume restores chapter, mode and position. Offline downloads
(Premium) cache a chapter's pages in the Cache API with a manifest in IndexedDB.

**Two downloads, and the copy has to keep them apart.** *Keep on this device* is the cache
above: pages live inside the PWA, readable with no connection, and they go when the reader
clears the browser. *Save the files* is `GET /api/chapters/:id/cbz` — a CBZ (a ZIP of the
page images in reading order plus `ComicInfo.xml`) that lands in the downloads folder and
opens in any reader app. Both sit in the Download sheet on the series page, per chapter, and
both are gated identically and server-side: the `offline` entitlement *and* the viewer's
right to read that chapter. The archive is streamed one page at a time — a 60-page chapter
at 1440px must never be assembled in memory — and rate-limited far more tightly than a page
read, because it is the one route where image bytes do pass through the application server.

PDF is deliberately not offered. PDF cannot embed WebP or AVIF, so every page would have to
be transcoded to JPEG per request: a large CPU cost on the box the CBZ route was carefully
kept cheap on, a bigger file, and a worse reading experience than the format the audience's
apps already open.

### Locked chapters

The reader route checks entitlement server-side. A non-entitled user gets the subscribe
page carrying series, cover and chapter, and returns to the chapter after paying. Page URLs
are never emitted for a chapter the user may not read.

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
