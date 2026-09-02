# PALScans — mockup brief for artboard authors

You are producing hi-fidelity static UI mockups for **PALScans**, a manhwa / manga / manhua
reading site (palscans.org). Everything you write is a standalone HTML artboard in the
"Design Component" format described in §4. Read this whole file before writing anything.

## 1. Deliverables (per design direction)

Three files, written to the working directory given in your task:

| File | Frame (root element size) | What it is |
|---|---|---|
| `Home<X>.dc.html` (direction A writes `Main.dc.html` instead) | **1440 × 2000** | the homepage, desktop |
| `Series<X>.dc.html` | **1440 × 1800** | the series (manga) detail page, desktop |
| `Reader<X>.dc.html` | **390 × 844** | the chapter reader, on a phone |

`<X>` is your direction letter. The root `<div>` inside `<x-dc>` MUST carry an inline
`style` with exactly that `width` and `min-height` and an explicit `background`. Content
that runs past the height is clipped, so keep the composition inside it; surplus space
paints the background, which is fine.

The reader is on a phone because that is where reading happens. Do **not** draw a fake iOS
status bar, clock, battery or keyboard — leave that area alone.

## 2. Brand and shared content — identical across all directions

Use these exactly, so the six directions can be compared fairly.

**Brand:** PALScans. Wordmark: "PAL" heavy + "Scans" regular, or a P-monogram in a rounded
square drawn as inline SVG. Never any other site's name anywhere in the artboard.

**Header** (desktop): logo · Home · Browse · Rankings · Genres · Bookmarks · a search field
("Search series…", with a ⌘K hint drawn as text) · bell icon · **Premium** button (the one
accent-filled control) · avatar circle.

**Series catalog** (type · status · rating · latest chapter · relative time):

| # | Title | Type | Status | Rating | Latest | Updated | Cover file |
|---|---|---|---|---|---|---|---|
| 1 | Return of the Frost Monarch | manhwa | ongoing | 9.6 | Ch. 301 | 12 min ago | cover-01.svg |
| 2 | Ashfall Regent | manhwa | ongoing | 9.4 | Ch. 154 | 1 hour ago | cover-02.svg |
| 3 | Solo Cartographer | manhwa | ongoing | 9.3 | Ch. 132 | 3 hours ago | cover-03.svg |
| 4 | The Villainess Keeps the Receipts | manhwa | ongoing | 9.2 | Ch. 96 | 5 hours ago | cover-04.svg |
| 5 | The Ninth Sword Saint | manhwa | ongoing | 9.1 | Ch. 88 | 8 hours ago | cover-05.svg |
| 6 | Overgrowth | manga | completed | 9.0 | Ch. 120 | 1 day ago | cover-06.svg |
| 7 | Dawnbreaker Guild | manhwa | ongoing | 9.0 | Ch. 178 | 1 day ago | cover-07.svg |
| 8 | Ironclad Heir | manhwa | ongoing | 8.9 | Ch. 141 | 2 days ago | cover-08.svg |
| 9 | Gilded Dungeon Broker | manhwa | ongoing | 8.9 | Ch. 67 | 2 days ago | cover-09.svg |
| 10 | Crown of Static | manhwa | ongoing | 8.8 | Ch. 59 | 3 days ago | cover-10.svg |
| 11 | Blood-Iron Academy | manhwa | ongoing | 8.7 | Ch. 212 | 3 days ago | cover-11.svg |
| 12 | Whisper Engine | manga | completed | 8.7 | Ch. 38 | 4 days ago | cover-12.svg |
| 13 | Ten Thousand Year Apprentice | manhua | ongoing | 8.6 | Ch. 402 | 5 days ago | cover-13.svg |
| 14 | Lantern Fox Chronicles | manhua | ongoing | 8.5 | Ch. 190 | 6 days ago | cover-14.svg |
| 15 | Ruin Diver | manga | ongoing | 8.4 | Ch. 73 | last week | cover-15.svg |
| 16 | Saint of the Rusted Cathedral | manhua | hiatus | 8.2 | Ch. 45 | 2 weeks ago | cover-16.svg |

Covers `cover-17.svg` … `cover-24.svg` also exist for extra slots (recommendations, hero
filler). Reference every cover as `<img src="cover-01.svg" …>` — the filename only, with
the `src` double-quoted. Give every cover `<img>` a fixed aspect via `aspect-ratio: 2 / 3`
and `object-fit: cover`.

**Latest-updates rows** show a series with its three most recent chapters, e.g. for
Frost Monarch: Ch. 301 · 12 min ago / Ch. 300 · 3 days ago / Ch. 299 · 6 days ago.

**Popular lists** (Weekly · Monthly · All time) use catalog order 1→10.

**Series page subject:** *Return of the Frost Monarch* — manhwa · ongoing · 2023 ·
rating 9.6 (12,481 ratings) · 301 chapters · 81.3K bookmarks · Rank #2 · author **Han Seo-jin** ·
artist **Studio Nocturne** · genres Action, Fantasy, Regression, Martial Arts, Revenge ·
alternative titles "서리 군주의 귀환" and "Frost Monarch's Return" · synopsis:
"Executed by the empire he built, Kael Vantheris wakes three hundred years in the past with
his memories intact and his power gone. The Frost Monarch has one winter to rebuild an army,
and this time he remembers every betrayal." Chapter list rows: Ch. 301 · 12 min ago
(Premium, early access — free in 23h) · Ch. 300 · 3 days ago · Ch. 299 · 6 days ago ·
Ch. 298 · last week … down to Ch. 292. Actions: **Read first** / **Continue Ch. 288** ·
Bookmark · Rate · Download (Premium). Include a "Read the novel" cross-sell card and a
Recommended grid (use catalog #2, #3, #5, #7, #9, #11).

**Reader subject:** Frost Monarch, Chapter 301, page 7 of 34 in view. Top bar: back arrow,
series title + "Chapter 301", comments icon. Bottom bar: Prev · chapter selector
("Chapter 301 ▾") · Next. Pages are tall dark rectangles stacked with zero gap — draw them
as `<div>` panels with a subtle gradient and a faint "Page 7 / 34" label in the corner of
one; do not use the cover images as pages. Show the reader with its chrome visible.

**Ad slots** — drawn as dashed-border boxes with a muted label in small caps, exact sizes,
never inside the reading strip:

- Home: `AD · Leaderboard 970×90` under the hero; `AD · MPU 300×250` in the sidebar; one
  `AD · Sponsored` native card inside the updates list.
- Series: `AD · Leaderboard 728×90` under the header; `AD · MPU 300×250` under the chapter
  list or in the sidebar.
- Reader: one `AD · 300×250` **after the last page, above the Next control** — represent it
  at the bottom of the phone frame above the bottom bar. Nothing between pages.

**Footer** (home and series, desktop): PALScans mark + tagline "Read manhwa, manga and
manhua, updated daily." · four link columns — Browse (Latest updates, Popular, Genres,
Rankings) · Account (Bookmarks, Reading history, Notifications, PALScans Premium) · Legal
(DMCA, Terms of service, Privacy policy, Contact) · Community — with a filled **Join the
Discord** button and a row of five social icons (X, Instagram, Reddit, YouTube, Facebook)
drawn as simple inline SVG glyphs · the line
"© 2026 PALScans. All series belong to their respective authors and publishers."

## 3. Craft rules

- Hi-fi. It should read as a screenshot of a shipped product, not a wireframe.
- Real copy from §2 only. No lorem ipsum, no "Series title here", no generic filler.
- **No emoji anywhere.** Icons are inline SVG: stroke-based, 20 or 24px grid, one style.
- Lay out sibling groups with `display:flex` / `display:grid` + `gap`. Grids use exactly
  `grid-template-columns: repeat(N, minmax(0, 1fr))`.
- Inline `style="…"` on elements for anything a viewer might restyle; a `<style>` block in
  `<helmet>` for fonts, resets and hover states only.
- Google Fonts only, via `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?…">`
  inside `<helmet>`, with a system fallback stack. Do not use Inter, Roboto, Arial or Bebas
  Neue.
- Touch targets in the phone reader ≥ 44px. Body text ≥ 13px on desktop, ≥ 14px on the phone.
- Close every element, double-quote every attribute. No `<script>` of your own (these are
  static artboards). No external images, no `data:` URIs, no JavaScript.
- Keep each file under ~120 KB.
- Text colour and background always come from the same palette; check contrast.
- Direction distinctness matters more than polish: if your artboard could be mistaken for
  another direction's, push harder on what makes yours different.

## 4. File format (exact)

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=…&display=swap">
  <style>
    body { margin: 0; }
    a { color: #c4b5fd; text-decoration: none; } a:hover { color: #ddd6fe; }
    /* resets, hover states, keyframes */
  </style>
</helmet>
<div style="width: 1440px; min-height: 2000px; background: #100d17; color: #ece9f4; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; overflow: hidden;">
  … the page …
</div>
</x-dc>
</body>
</html>
```

Keep the `<script src="./support.js"></script>` line exactly as shown. Do not add a
`<script data-dc-script>` block. Always define `a` and `a:hover` colours in the style block.

## 5. Working method

Write each file with a heredoc or the Write tool, then confirm it exists and its size
(`wc -c`). Re-read each file once and fix: any unclosed tag, any emoji, any lorem, any
missing ad slot or footer element, any `src` that isn't one of the cover files, any root
`<div>` that isn't the exact frame size. Your final message is a short manifest: the three
file paths, their sizes, the fonts you used, and one sentence on what makes your direction
distinct.
