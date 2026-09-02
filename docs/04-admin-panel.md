# 04 — Admin panel

Mounted at `/admin`, in the same Next.js app, behind a middleware check on
`can(user, 'admin.access')`. Data-dense, keyboard-driven, and built for the one workflow
that happens a hundred times a week: **publish a chapter**.

## Permission model

Roles are bundles of permissions, and the code checks permissions, never roles. Adding a
"fixing manager" who may only replace broken pages then takes one line, not a refactor of
every `if (role === 'admin')` in the codebase.

```ts
// packages/core/permissions.ts
export const PERMISSIONS = [
  'admin.access',
  'series.read','series.create','series.update','series.delete','series.feature',
  'chapter.read','chapter.create','chapter.update','chapter.delete','chapter.publish',
  'chapter.repair',                     // replace pages on an existing chapter, nothing else
  'comment.moderate','user.read','user.update','user.ban','user.role',
  'report.handle','announcement.write','entitlement.grant','settings.write','audit.read',
] as const

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  user:      [],
  supporter: [],
  premium:   [],
  uploader:  ['admin.access','series.read','chapter.read','chapter.create',
              'chapter.update','chapter.repair'],
  moderator: ['admin.access','series.read','series.update','chapter.read','chapter.update',
              'chapter.publish','chapter.repair','comment.moderate','user.read','user.ban',
              'report.handle'],
  admin:     PERMISSIONS,
}

export const can = (u: SessionUser | null, p: Permission) =>
  !!u && ROLE_PERMISSIONS[u.role].includes(p)
```

Note what `uploader` cannot do: publish. Uploads land in `ready` and a moderator releases
them. That one boundary prevents most of the damage an over-eager volunteer can cause.

Enforcement lives in the route handler, in a wrapper that is impossible to forget:

```ts
export const POST = withPermission('chapter.publish', async (req, { user, params }) => { … })
```

## Navigation

```
Dashboard
Content ─ Series · Chapters · Upload queue · Announcements · Media library
Community ─ Comments · Reports · Users
Business ─ Subscriptions · Entitlements · Promo codes
Appearance ─ Theme · Layouts · Homepage sections · Header & footer · Announcement bar   (see 15-appearance.md)
System ─ SEO · Redirects · Audit log · Settings · Feature flags · Jobs
```

## Dashboard

Six tiles, one job list. Views today with a sparkline against last week; new users; chapters
published today; active subscriptions and MRR delta; **open reports** as a red badge; and
**failed jobs** — because a silently failing image queue is the outage you find out about
from Discord. Below: the live job queue with per-job progress, and the next ten scheduled
chapters with countdowns.

## Series editor

A single page, tabbed, autosaving drafts every 3 seconds with an explicit "Publish" gate.

- **Details** — title, slug (auto from title, editable, warns on collision), type, status,
  synopsis with a live preview, release year, serialization, age rating, release schedule.
- **Titles** — repeater for alternative titles with optional language tag. Paste a
  newline-separated list and it splits into rows.
- **Art** — cover and banner dropzones with a fixed-ratio cropper (2:3 covers, 16:5 banners).
  Preview renders at the exact sizes the grid and hero will use, so a bad crop is visible
  before publish, not after.
- **People** — author/artist/translator pickers with typeahead that creates on the fly.
- **Genres** — multi-select chips grouped by kind.
- **Relations** — link a comic to its novel counterpart, add recommendations.
- **Visibility** — draft/scheduled/published/unlisted, featured, pinned, comments on/off,
  per-country allow/block list.
- **Chapters** — the embedded chapter table, described below.

## Chapter management — the core workflow

The chapter table under a series supports multi-select with shift-range, and a bulk bar
appears on selection: **Publish now · Schedule… · Set premium · Clear premium · Set early
access window · Delete**. Editing 60 chapters' premium flags one at a time is how people
come to hate an admin panel.

### Bulk uploader

Drop a folder, a CBZ, or many folders at once. For each detected chapter:

1. Chapter number is parsed from the folder or archive name (`Ch. 154`, `chapter-154`,
   `154.5`) and shown in an editable field — parsing is a suggestion, never silent.
2. Pages are natural-sorted and rendered as a thumbnail grid, reorderable by drag, with
   per-page delete and "insert here".
3. Warnings surface inline before upload: a page much narrower than its neighbours
   (a mis-scaled scan), a duplicate hash (the same page twice), a suspicious gap in
   numbering, a non-image file.
4. One "Upload N chapters" button. Uploads run 4-wide with per-file progress, survive tab
   switches, and are resumable — a dropped connection retries the failed files, not the
   whole chapter.

Then the queue view shows each chapter moving `uploading → processing → ready`, with live
page-level progress from the worker over Server-Sent Events.

### Scheduling

Set `published_at` in the future and the chapter enters `scheduled`. A worker running every
30 seconds publishes anything due, then fans out notifications to bookmarkers. Premium
early access is a separate field: `early_access_until` makes it visible to entitled users
now and everyone at that timestamp. The editor shows the resulting timeline in words —
"Premium readers: now. Everyone: Friday 18:00 your time (in 2 days)" — because timezone
mistakes in scheduling are otherwise only discovered by the audience.

### Repair

`chapter.repair` lets a fixing role replace individual pages on a published chapter without
touching metadata or state. Replaced pages get new content-addressed keys, so no cache
purge is needed and the old bytes stay recoverable. Every repair writes an audit row.

## Moderation

**Reports** is one queue with a `kind` filter, not five separate screens. Each row expands
to show the reported object in context with the actions that make sense for its kind:
delete comment, warn, comment-ban for N days, ban user, dismiss. Keyboard: `j`/`k` to move,
`d` to dismiss, `a` to action. A moderator clearing 200 reports should never touch a mouse.

**Comments** is specified in full in `14-comments.md`: a Pending · Reported · Flagged · All
queue, links held by default with a domain allowlist, word filters, automod scoring,
shadow-bans, the community image collection, and per-page locks.

**Users** — search by email, username, or id. The detail view shows role, entitlements,
subscription status, sessions (each revocable individually), recent comments, uploads, and
the audit trail of actions taken *against* them. Actions: change role, grant/revoke
entitlement with an expiry, comment-ban, ban, force logout everywhere, resend verification.

Role changes require a typed confirmation of the username and are always audited. Nobody
can change their own role.

## Appearance → Layouts

One click to switch the look of each page type, no deploy. Every page type has a set of
registered layout implementations — the six mockup directions become six homepage layouts
and six series-page layouts as they are built — and a single setting selects which one
renders:

```ts
// settings.layouts
{ home: 'B', series: 'A', reader: { default_mode: 'strip' } }
```

The screen shows a row of radio cards per page type (thumbnail, name, a **Live** pill on
the current one, a Preview link that opens the page with `?layout=C` for staff only) and a
Save button. Saving writes the setting, purges the HTML cache for that page type and
records an audit row; the change is visible on the next request. Only layouts that have
actually been built appear — a card for a direction that isn't implemented yet is shown
disabled with "not built".

The same screen carries the reader settings: **default mode** (long strip · paged),
**desktop skyscrapers** on/off with size (160×600 · 300×600), **mobile in-strip ad every**
(off · 2 · 4 · 6 pages) with a live preview of a strip, and the **end-of-chapter slot**
on/off. Ad network tags per slot live in Business → Ads.

Building and maintaining six layouts per page type is real front-end cost; the switcher
is cheap. The recommendation is to build the chosen layouts first, ship the switcher with
them, and add alternates when there is a reason to A/B them.

## SEO

Its own page under System, specified in full in `12-seo.md`: title and description
templates per page type with a live preview, the sitemap panel (enable/disable, custom
sitemap URL, sections, regenerate now, IndexNow key), the feeds panel (enable/disable,
custom feed URL), indexing rules (site, chapter pages, profiles), verification tags,
Organization identity and social `sameAs` links, the redirects table with CSV import, the
`robots.txt` editor, and the JSON-LD validator. The series editor gains an **SEO** tab
(title, description, focus keyword with a checklist, the "About" rich-text block, noindex,
canonical, OG image), and the genre editor gains an intro rich-text block and FAQ entries.

## Audit log

Filterable by actor, action, target, and date; every row shows a `before`/`after` JSON diff.
This is what turns "who deleted the series" from an argument into a query.

## Interaction rules

These sound minor and are the difference between a panel people use and one they work around:

- Every destructive action is undoable for 10 seconds via a toast, or requires typed
  confirmation if it cannot be.
- Every table remembers its filters, sort, and page in the URL, so admins can share links.
- Optimistic updates with rollback on failure; never a full-page spinner over a table.
- `⌘K` command palette: jump to series, jump to user, upload chapter, view queue.
- Session extends silently while active; a save never fails because a session expired
  mid-form. Draft state is in `localStorage` too, so a crash costs nothing.
- The panel is usable on a tablet in portrait. Not phone-optimised — nobody uploads a
  40-page chapter from a phone — but a moderator clearing reports on an iPad is a real
  workflow.
