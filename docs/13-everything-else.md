# 13 — Everything else

The checklist of what a platform like this needs beyond the headline features, so nothing
depends on anyone remembering it later. Each row: what it is, the one-line spec, and
whether it ships in v1 or later. Items already covered in another doc point there.

## Reading experience

| Feature | Spec | When |
|---|---|---|
| Right-to-left paged mode | Manga reads right-to-left; a per-series default (`reading_direction`) and a reader toggle. Manhwa/manhua default to vertical strip | v1 |
| Data-saver quality | Reader setting: Auto · High (1080) · Saver (720). Persisted per device; Saver default on cellular via `navigator.connection` when available | v1 |
| Skip to first unread | On the series page, "Continue" resolves to the first chapter after the last one read, not the last opened | v1 |
| Next-chapter countdown | When `chapters.published_at` is in the future, the series page and reader end show "Ch. 302 in 2d 4h" instead of a dead end | v1 |
| Season / volume grouping | `chapters.volume` is already in the schema; render collapsible "Season 2" groups when set | v1 |
| Report a page | One tap in the reader flags a specific page (missing, wrong order, low quality) → `reports` with `kind = 'broken_chapter'` and the page index | v1 |
| Keyboard shortcut sheet | `?` opens the list | v1 |
| Reading stats | Chapters read, series finished, current streak on the profile | later |
| Custom reading lists | User-named lists beyond the five bookmark statuses | later |
| Comments per chapter | Already in `02-data-model.md`; the reader's comment button jumps to them | v1 |

## Catalog and discovery

| Feature | Spec | When |
|---|---|---|
| Exclude filters | Browse supports *exclude* genres and tags, not just include — the most-requested filter on every site of this kind | v1 |
| Tags alongside genres | `genres.kind` already distinguishes `genre` / `theme` / `format`; themes (regression, system, dungeon, academy…) are tags | v1 |
| Min chapters / min rating filters | Two sliders on browse | v1 |
| Release schedule, structured | Replace the free-text `series.release_schedule` with `{weekday, time, tz}` so a `/schedule` calendar page and "next release" badges can be generated | v1 |
| Release calendar page | `/schedule`: a 7-day grid of expected releases, driven by structured schedules and scheduled chapters | v1 |
| Random series | A button in the nav and on empty states | v1 |
| Recently added / completed rails | Two more home rails, toggleable in the homepage layout editor | v1 |
| "Users also read" | Co-bookmark counts, recomputed nightly | later |
| Series requests | Users request titles; staff triage in the reports queue as `kind = 'request'` | later |

## Scanlation-specific

| Feature | Spec | When |
|---|---|---|
| Groups and credits | `groups` table (name, slug, logo, links) and `chapter_groups`; chapters show "by {group}", group pages list their releases | v1 |
| Team recruitment page | `/join`: open roles (translator, cleaner, typesetter, proofreader) with an application form that lands in the reports queue | v1 |
| Team / credits page | `/team` with staff and group listings pulled from the same tables | v1 |
| Optional watermark at ingest | Per-group or per-series small corner mark composited by the worker; off by default; never re-applied to already processed pages | later |
| Nightly broken-image scan | A job that HEADs every `chapter_pages` object and flags missing ones into the reports queue before readers find them | v1 |
| CDN warm-up on publish | After processing, the worker fetches the first five pages through `cdn.palscans.org` so the first reader hits a warm cache | v1 |
| Bulk CBZ export | Admin can download a chapter or series as CBZ for backup | later |

## Content safety

| Feature | Spec | When |
|---|---|---|
| Age gate | `series.age_rating = 'mature'` → an 18+ confirmation interstitial stored in a cookie; covers blurred in listings until confirmed | v1 |
| Safe mode | Account setting that hides mature series entirely from browse, search and feeds | v1 |
| Content warnings | Free-form warning tags shown under the synopsis | v1 |
| Spoiler tags in comments | Already in the comment body schema (`is_spoiler` + inline spoiler nodes) | v1 |

## Accounts and security

| Feature | Spec | When |
|---|---|---|
| Discord OAuth | Second provider after Google; links the Discord bot identity in one step | v1 |
| Magic-link login | Email a one-time sign-in link; removes most password-reset tickets | later |
| Breached-password check | k-anonymity lookup against Have I Been Pwned on register and password change | v1 |
| 2FA (TOTP) for users | Optional for everyone; mandatory for `admin` (see `07-auth-and-monetization.md`) | v1 |
| Sessions page | Device, approximate location, last seen, revoke each / all | v1 |
| Username change | Once per 30 days; old name reserved for 90 days; redirects the profile URL | v1 |
| Account deletion | Self-service with a 14-day grace period; anonymises comments rather than deleting them | v1 |
| Data export | Bookmarks, history, comments as JSON/CSV — the GDPR "right of access" | v1 |
| Bot protection | Cloudflare Turnstile on register, login after failures, comment posting and the contact form | v1 |

## Notifications

| Feature | Spec | When |
|---|---|---|
| Web Push | Browser push for new chapters on bookmarked series — the strongest retention lever available to a PWA | v1 |
| Email digest | Opt-in daily or weekly "new chapters for you" | v1 |
| Discord channel webhooks | Admin-configured webhooks post new-chapter embeds to a channel; separate from the per-user bot DMs | v1 |
| Notification preferences | Per channel (in-app · push · email · Discord) × per kind (new chapter · reply · reaction · announcement) | v1 |

## Monetisation and money

| Feature | Spec | When |
|---|---|---|
| Stripe Tax | Automatic VAT/GST on subscriptions — required in the EU and UK from the first sale | v1 |
| Invoices and receipts | Stripe-hosted, linked from the billing page | v1 |
| Gift premium | Buy a month for another username | later |
| Support links | Patreon / Ko-fi / Buy-me-a-coffee links in the footer and a "Support us" page, configurable | v1 |
| Ad slot manager | Enable/disable each slot from `11-ads-footer-community.md`, paste the network tag per slot, preview | v1 |
| `ads.txt` editor | Served at `/ads.txt`; ad networks refuse to serve without it | v1 |
| Ad-blocker handling | Detect and show a polite one-line note with a Premium link; never block the reader | v1 |
| Ebooks / merch | Links out to a store; native store later | later |

## Site management (admin)

| Feature | Spec | When |
|---|---|---|
| Layout switcher | One-click choice of homepage, series-page and reader layout among the built versions, with preview — see `04-admin-panel.md` Appearance → Layouts | v1 |
| Homepage layout editor | Reorder, enable and disable home sections (hero, continue reading, trending, latest, popular, rails, announcements) with per-section item counts — the control the old theme's widgets gave you, done properly | v1 |
| Menu editor | Header and footer link groups editable without a deploy | v1 |
| Theme settings | Logo, favicon, accent colour, default theme (dark / light / system), custom CSS box | v1 |
| Announcement bar | A dismissible site-wide bar with rich text, schedule and per-audience targeting (everyone / signed-in / premium) | v1 |
| Maintenance mode | Toggle with an ETA message; staff bypass by role | v1 |
| Registration controls | Open · invite-only · closed; email-domain blocklist | v1 |
| Feature flags | Per-flag on/off and percentage rollout, editable in admin | v1 |
| Custom head/footer HTML | For verification tags and analytics snippets; admin-only, logged in the audit trail | v1 |
| Analytics | Privacy-friendly first-party dashboard (views, readers, top series, referrers) plus an optional Plausible / GA id | v1 |
| Email templates | Editable subject and body for verification, reset, digest, receipt, with preview | v1 |
| Webhooks and API keys | Outgoing webhooks on `chapter.published`, `series.created`; keys for the Discord bot and future apps | v1 |
| Roles and permissions editor | Create custom roles as permission bundles in the UI (the model in `04-admin-panel.md`) | later |
| Import / export | Bulk CBZ folder import (already in the uploader), series metadata CSV import/export, the legacy-site importer | v1 |
| Backup now | One-click database dump to R2 plus the scheduled backups from `08-infrastructure-and-cost.md` | v1 |
| Trash and restore | Everything is soft-deleted; a Trash view with restore for series, chapters, comments, users | v1 |
| Ban list | User, email, IP and ASN bans with reasons and expiry; visible in the audit log | v1 |
| Comment automod | Word and link filters, new-account rate limits, shadow-ban | v1 |

## Legal and compliance

| Feature | Spec | When |
|---|---|---|
| Terms, Privacy, DMCA, Cookie, Content policy pages | Rich-text pages editable in admin; versioned; the DMCA page carries the agent details and the notice form from `07-auth-and-monetization.md` | v1 |
| Cookie consent | Only shown where required (EU/UK by `CF-IPCountry`); necessary cookies only until accepted; ad tags wait for consent | v1 |
| GDPR requests | Export and deletion above; a `/privacy/request` form that lands in the reports queue | v1 |
| Age verification | The age gate above; nothing stronger unless a jurisdiction requires it | v1 |

## Product surfaces easy to forget

| Feature | Spec | When |
|---|---|---|
| 404 / 410 / 500 pages | Designed, with search and popular series on 404; 410 for removed titles (see `12-seo.md`) | v1 |
| Offline page | The PWA's fallback when there is no network, listing downloaded chapters | v1 |
| Help centre / FAQ | Rich-text pages plus the FAQ block on genre pages | v1 |
| Contact page | Form → reports queue; the address for DMCA and billing | v1 |
| Changelog | "What's new" page fed from announcements tagged `changelog` | later |
| Status page | External uptime page (Instatus / Better Stack free tier) linked from the footer | v1 |
| Share targets | OS share sheet on mobile; copy link, X, Reddit, Discord buttons on series and chapters | v1 |
| Open Graph images | Generated per series (cover + title + rating) at 1200×630 for link previews | v1 |
| Leaderboard | Top commenters and readers by month, if the community wants it | later |
| Novels vertical | Deferred in `10-roadmap.md`; the schema already allows it | later |

## Engineering hygiene

| Feature | Spec | When |
|---|---|---|
| UI strings i18n-ready | All interface copy through a message catalogue from day one; adding a language later is then translation, not a rewrite. Content stays single-language | v1 |
| Timezone-aware display | All times stored UTC, rendered in the viewer's zone client-side from ISO attributes | v1 |
| Rate limiting everywhere | Per-route budgets in Redis; documented in one table | v1 |
| Brotli, HTTP/3, early hints | Via Cloudflare; `103 Early Hints` for the cover preload | v1 |
| CDN purge on repair | Content-addressed keys make it unnecessary for pages; HTML purge on series change via the Cloudflare API | v1 |
| E2E tests on the money paths | Register → verify → subscribe → read early access; upload → process → publish → read | v1 |
| Runbooks | Restore, rotate secrets, take down a title, handle a chargeback, roll back a deploy | v1 |

## What this changes elsewhere

- `02-data-model.md`: add `groups`, `chapter_groups`, `series.reading_direction`,
  structured `series.release_schedule`, `series.content_warnings`, `push_subscriptions`,
  `notification_prefs`, `bans`, `webhooks`, `api_keys`, `pages` (legal / help rich text),
  `home_layout` and `menus` in settings.
- `04-admin-panel.md`: the System group gains Homepage layout, Menus, Theme, Announcement
  bar, Ads, Analytics, Email templates, Webhooks, Legal pages, Trash, Bans.
- `10-roadmap.md`: v1 items above fold into Phases 2–5; none of them changes the order of
  work or the twelve-week shape, because most are small once the spine exists.
