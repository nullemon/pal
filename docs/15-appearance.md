# 15 — Appearance settings

Everything about the look of PALScans that the operator changes from the admin panel,
without a deploy. The principle: the design system in `05-design-system.md` is expressed
as tokens, and Appearance edits the tokens. Components never carry literal colours, so a
change here reaches every page, every email and the PWA icon in one save.

## How it works technically

1. Appearance settings live in a single versioned JSON document (`appearance_settings`).
2. On save, the server resolves the settings into a CSS custom-property block — the full
   token set from `05-design-system.md`, light and dark — and writes it to the cache. The
   page shell inlines that block in `<head>` (a few hundred bytes), so there is no extra
   request and no flash of the old theme.
3. Tailwind v4 utilities reference the same custom properties, so utilities follow the
   change too.
4. Every save is versioned with who/when, previewable by staff before publishing, and
   revertible in one click.

## Brand and identity

| Setting | Notes |
|---|---|
| Site name, tagline | used in the header wordmark fallback, footer, `<title>` templates, emails, manifest |
| Logo | pick one of the ten directions in `design/logos/`, or upload your own: separate uploads for dark and light backgrounds, SVG preferred; a monogram for small sizes and the PWA icon; sizes generated automatically |
| Favicon | generated from the monogram in every required size, including maskable |
| Default social image | 1200×630 used when a page has no better OG image |
| Wordmark style | logo only · logo + name · name only |

## Colour

**Accent** is the headline control: one hue, and the platform derives the whole ramp.

- A colour picker with hex input, an eyedropper, and a row of presets (violet, indigo,
  blue, teal, green, amber, rose, red, mono).
- From the chosen colour the server derives, in OKLCH: `brand`, `brand-hover`, `brand-dim`,
  `brand-wash`, `brand-ink` (text on brand), and the focus glow, for **both** themes — the
  light-theme accent is darkened until it passes contrast on white.
- A contrast panel shows the results live: brand on page ≥ 3:1, brand-ink on brand ≥ 4.5:1,
  links on surface ≥ 4.5:1 — with a warning, not a block, when a chosen colour fails.
- Optional **secondary accent** for the Premium button and gold ratings; defaults to a
  derived gold.
- **Surface tint**: the neutral ramp can carry a hint of the accent hue (0–8% chroma). This
  is what makes a violet site feel violet even where nothing is purple.
- **Type and status chip colours** (manhwa / manhua / manga / comic; ongoing / completed /
  hiatus / cancelled) are editable, each with a light and dark value.
- Live preview: a panel of real components — header, series card, chapter row, buttons,
  chips, a comment — re-renders as you drag.

## Theme

| Setting | Options |
|---|---|
| Default theme | dark · light · follow system |
| Let readers switch | on / off; the toggle lives in the header menu |
| Reader background default | black · dark · sepia · white (readers can override per device) |
| Reduced-motion default | respect the OS setting (always), plus a site-wide "no shimmer" switch |

## Typography

| Setting | Options |
|---|---|
| Display face | a curated list of self-hosted, subset faces (the pairings from `05-design-system.md` plus a few alternates), never a font proxy |
| Body face | same list |
| Pairing presets | "Bold condensed + humanist", "Geometric + grotesque", "Editorial", "System only (fastest)" |
| Base size | 15 / 16 / 17 px |
| Heading weight | 600 · 700 · 800 |

Adding a face outside the list means adding its subset files to the repo — a deliberate
engineering change, not a setting, because a font is a performance budget line.

## Shape and density

| Setting | Options |
|---|---|
| Corner radius | sharp (2px) · soft (8px) · round (14px) · pill for buttons |
| Card style | flat · bordered · elevated (shadow) |
| Density | comfortable · compact (tighter grids, smaller cover cards, 48px → 40px rows) |
| Cover grid | title below · title overlay on hover · title overlay always |
| Cover aspect | 2:3 (default) · 3:4 |
| Badges on cards | rating on / off · type chip on / off · "NEW" pill threshold (hours since publish) |

## Layout and sections

Specified in `04-admin-panel.md` (Appearance → Layouts) and `13-everything-else.md`:
one-click layout choice per page type; the homepage sections editor (order, on/off, item
counts, per-section title); hero style (carousel · featured card · off) and item count;
series page banner style (blurred cover · banner image · none); chapter list default sort;
sidebar on / off.

## Header, footer, menus

| Setting | Notes |
|---|---|
| Header links | ordered list with labels, targets, and "show on mobile" flags |
| Primary button | label and target of the accent-filled header control (Premium by default) |
| Footer columns | up to four named columns of links, editable |
| Community | Discord invite URL, X, Instagram, Reddit, YouTube, Facebook, RSS toggle, support links (Patreon · Ko-fi · Buy me a coffee) |
| Copyright line, attribution line | text |
| Announcement bar | rich text, colour (info · warning · promo), schedule, audience, dismissible |
| Mobile bottom nav | which four items |

## Reader defaults

Default mode, skyscrapers on/off and size, in-strip interval, end-of-chapter slot, page gap,
preload — see `06-frontend-and-reader.md`. Per-device reader settings chosen by readers
always win over these defaults.

## Copy the operator owns

Editable strings for the places that carry the site's voice: the home hero eyebrow, empty
states ("No bookmarks yet — start with Trending"), the age-gate text, the ad-blocker note,
the maintenance page, the 404 page line, the login-page tagline, the Premium pitch bullets,
email subjects and intros. Everything else goes through the i18n catalogue.

## Formatting

| Setting | Options |
|---|---|
| Relative times | "12 min ago" style · absolute dates · both (relative with absolute on hover) |
| Clock | 12h · 24h |
| Compact numbers | 81.3K · 81,300 |
| Chapter label | "Ch. 301" · "Chapter 301" · "#301" |
| Week starts on | Monday · Sunday (release calendar) |

## Advanced

| Setting | Notes |
|---|---|
| Custom CSS | a text box applied after the theme, scoped to the public site; syntax-checked; changes audited |
| Custom head / footer HTML | for analytics snippets (search-engine verification tags live on the SEO screen, `12-seo.md`); admin-only |
| PWA | app name, short name, theme colour and icons are generated from the settings above; the install prompt copy is editable |
| Email theme | logo, accent and footer text applied to every transactional template |

Both boxes are `appearance.advanced`, a permission only the `admin` role can hold and which
`Access → Roles` refuses to grant to any other — a snippet is a `<script>` on every public
page, and custom CSS is not much weaker (a fixed full-size layer swallows clicks; a remote
`url()` hands every reader's IP to a third party), so the two share one door rather than the
CSS box sitting behind `settings.write`.

Three things about how it is built are load-bearing:

- **Scoped by the route tree, not by a selector.** The components that render it are mounted
  by `app/(site)/layout.tsx` only. The panel, the staff sign-in and the reader auth pages are
  sibling route groups, so operator code is not in their tree at all and cannot reach
  `/admin` however hostile it is. That is also the way back from a bad save: this screen stays
  reachable, and a master switch turns all three boxes off without losing their contents.
- **The snippets go at the top and bottom of the page body, not inside `<head>`.** The
  `<head>` is rendered by the root layout, which the admin panel shares. Analytics loaders and
  pixels behave identically there; a `<meta>` tag would not, so one is refused with a pointer
  to the SEO screen rather than silently ignored.
- **No CSP is in force on this app's HTML today** (`infra/Caddyfile` sets HSTS, nosniff,
  X-Frame-Options, Referrer-Policy and Permissions-Policy, and nothing adds a CSP), so
  snippets run. The screen says so, and lists the off-site hosts each snippet loads from,
  because the day `08-infrastructure-and-cost.md`'s "CSP with nonces" lands is the day every
  one of those has to be allowed or the box silently stops working.

## Presets, preview, history

- **Presets**: save the current appearance as a named preset; ship with the six mockup
  directions' palettes and pairings as starting presets; export / import as JSON.
- **Preview**: every change is a draft until published. Staff see the draft on the live
  site with `?preview=appearance`; nobody else does.
- **History**: each publish is a version with a diff; revert restores it in one click and
  purges the cache. All of it lands in `audit_log`.

## Data model

```sql
CREATE TABLE appearance_settings (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  settings     jsonb NOT NULL,                  -- the full document
  resolved_css text  NOT NULL,                  -- the derived token block, cached
  status       text  NOT NULL DEFAULT 'draft',  -- draft | published | archived
  published_at timestamptz,
  created_by   bigint REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON appearance_settings ((status)) WHERE status = 'published';

CREATE TABLE theme_presets (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  settings   jsonb NOT NULL,
  is_builtin boolean NOT NULL DEFAULT false,
  created_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```
