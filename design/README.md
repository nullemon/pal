# Design

## Mockups — six directions, reader v2, admin screens

`mockups/` holds the 18 artboards published on the PALScans Directions canvas: for each of
six design directions, a desktop homepage (1440 wide), a desktop series page (1440 wide) and
a phone reader (390 × 844). Each artboard is a self-contained static HTML file in the
Design Component format (`*.dc.html`); `canvas.json` is the canvas layout and the sticky
notes; `covers/` holds the 24 procedural placeholder covers the artboards reference;
`BRIEF.md` is the shared brief every direction was authored against (brand, content, ad
slots, footer, craft rules).

| Dir | Name | Layout family |
|---|---|---|
| A | Violet Classic | the familiar dark-violet manga-site layout — carousel hero, updates grid, popular sidebar (ASURA-STYLE) |
| B | Violet Refined | same information architecture, calmer execution — featured card, card grid, glass chrome (ASURA-STYLE) |
| C | Editorial Noir | magazine — headline hero, oversized numerals, hairlines |
| D | Catalog Grid | library — filters as the hero, dense grid, mono numerals |
| E | Daylight | the light theme, end to end including the reader |
| F | Cinematic Rows | streaming-app feel — full-bleed hero, horizontal rails, glass pills |

**Chosen:** homepage **A · Violet Classic**, series page **B · Violet Refined** (both
Asura-style layout family, original execution). These are the defaults in Appearance →
Layouts; the other directions remain selectable there once built.

A's homepage is `A/Main.dc.html` (the canvas entry artboard). All content is the shared
sample catalog from the brief; covers are placeholders, not real artwork. The chosen
direction becomes the basis for `docs/05-design-system.md` tokens and the component set.

## Reader v2 (`mockups/reader-v2/`)

The first reader set was rejected; this one is built around the two modes the operator
asked for. Neutral dark palette so it fits the chosen homepage.

| File | Frame | Shows |
|---|---|---|
| `ReaderStripDesktop` | 1440×1000 | long strip — every page in one column, sticky 160×600 skyscrapers in both gutters |
| `ReaderPagedDesktop` | 1440×1000 | paged — one page fit to height, click zones, chapter + page selects, scrubber, skyscrapers |
| `ReaderImmersiveDesktop` | 1440×1000 | the strip with chrome hidden: floating pill and progress line |
| `ReaderStripMobile` | 390×1700 | the strip on a phone with the in-strip ad after every 4 pages (admin-set interval) |
| `ReaderPagedMobile` | 390×844 | paged on a phone, first-run tap-zone overlay, counter, scrubber |
| `ReaderSettingsMobile` | 390×844 | the settings sheet: mode, direction, fit, quality, preload, background, Go Premium |

## Admin screens (`mockups/admin/`)

`AdminLayouts` — Appearance → Layouts: one-click choice of the live homepage and series
layout among the six directions, reader default mode, desktop skyscrapers, mobile in-strip
interval, end-of-chapter slot. `AdminTheme` — Appearance → Theme: accent colour with the
derived ramp and contrast checks, secondary accent, surface tint, theme default, fonts,
radius and density, type/status colours, and a live component preview.

`B/SeriesB.dc.html` now carries the comment system from `docs/14-comments.md`.
