# 05 — Design system (the theme)

**Direction:** the dark violet reading-platform idiom you liked on Asura — deep near-black
ground, a saturated purple accent, dense cover grids, coloured type and status chips —
built as our own tokens and components. The layout conventions are shared because readers
expect them. The stylesheet is ours: nothing is lifted from Madara's theme files or from
Asura's compiled CSS.

## Tokens

CSS custom properties consumed by Tailwind v4's CSS-first `@theme`. Dark is the default and
the primary target. Every value is expressed in **OKLCH**, which is why the surface ramp
reads as evenly spaced — sibling steps chosen in hex bunch up in the midtones, because hex
lightness is not perceptually uniform.

```css
@theme {
  /* Ground and surfaces — six steps. Depth comes from luminance, not from a border
     drawn around every panel. */
  --color-bg:        oklch(0.155 0.020 300);   /* page ground, deep violet-black */
  --color-surface-1: oklch(0.196 0.022 300);   /* cards, list rows */
  --color-surface-2: oklch(0.233 0.024 300);   /* raised: dropdowns, sheets, header */
  --color-surface-3: oklch(0.280 0.026 300);   /* hover, active, input fills */
  --color-line:      oklch(0.330 0.028 300);
  --color-line-soft: oklch(0.255 0.022 300);

  /* Text ramp */
  --color-fg:        oklch(0.970 0.006 300);
  --color-fg-muted:  oklch(0.740 0.016 300);
  --color-fg-subtle: oklch(0.580 0.018 300);

  /* Brand — one hue, committed to. Violet, in the family you picked. */
  --color-brand:      oklch(0.600 0.216 300);
  --color-brand-hover:oklch(0.660 0.216 300);
  --color-brand-dim:  oklch(0.380 0.130 300);
  --color-brand-ink:  oklch(0.985 0.010 300);  /* text on a brand fill */
  --color-brand-wash: oklch(0.255 0.060 300);  /* tinted surface, selected rows */

  /* Semantic — separate from the accent, never reused as decoration */
  --color-ok:     oklch(0.720 0.150 150);
  --color-warn:   oklch(0.790 0.150  75);
  --color-danger: oklch(0.640 0.200  25);
  --color-gold:   oklch(0.800 0.140  85);      /* premium, ratings */

  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 14px; --radius-full: 999px;
  --shadow-1: 0 1px 2px oklch(0 0 0 / .45);
  --shadow-2: 0 10px 30px -12px oklch(0 0 0 / .70);
  --glow-brand: 0 0 0 1px var(--color-brand-dim), 0 6px 24px -10px var(--color-brand);

  --font-display: "Anton", "Bebas Neue", ui-sans-serif, system-ui, sans-serif;
  --font-body:    "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono:    ui-monospace, "JetBrains Mono", monospace;
}
```

### Light theme, cheaply

Asura is dark-only. That costs the readers who prefer light and every reader in daylight.
Because components reference tokens and never literals, light is a token block, not a
rewrite:

```css
:root[data-theme="light"] {
  --color-bg:        oklch(0.985 0.004 300);
  --color-surface-1: oklch(1.000 0     300);
  --color-surface-2: oklch(0.968 0.006 300);
  --color-surface-3: oklch(0.940 0.010 300);
  --color-line:      oklch(0.890 0.012 300);
  --color-line-soft: oklch(0.935 0.008 300);
  --color-fg:        oklch(0.200 0.020 300);
  --color-fg-muted:  oklch(0.450 0.022 300);
  --color-fg-subtle: oklch(0.580 0.020 300);
  --color-brand:     oklch(0.510 0.210 300);   /* darkened so it passes on white */
  --color-brand-wash:oklch(0.960 0.030 300);
}
```

Ship dark as the default with the toggle in settings, and honour `prefers-color-scheme` on
first visit. **The reader gets its own background control regardless** — black, dark, sepia,
white — because that preference is about the artwork, not the UI.

### Semantic colours as tokens

Type and status colours live here, not scattered through components:

```css
--type-manga:  oklch(0.620 0.160 250);   /* blue   */
--type-manhwa: oklch(0.620 0.170  25);   /* red    */
--type-manhua: oklch(0.620 0.130 165);   /* teal   */
--type-comic:  oklch(0.640 0.150 300);

--status-ongoing:   oklch(0.620 0.160 250);
--status-completed: var(--color-ok);
--status-hiatus:    var(--color-warn);
--status-cancelled: var(--color-fg-subtle);
```

## Typography

Two families. A condensed display face for headings, chapter numbers, ranks and ratings —
the places where density and impact matter — and a variable sans for everything read in
sentences.

Self-host both as **subset woff2**, `font-display: swap`, with a `<link rel="preload">` for
the two faces above the fold. Do not use an automatic font proxy: Asura's login page ships
roughly 120 unicode-range subsets of a Japanese face to render a page containing no
Japanese. Subset to `latin` + `latin-ext`, and load CJK ranges only in the one component
that genuinely renders them — the alternative-titles list — lazily and scoped.

```
display   clamp(2.0rem, 1.4rem + 3vw, 3.4rem)   /* series title over the banner */
h1        clamp(1.6rem, 1.3rem + 1.4vw, 2.2rem)
h2        1.35rem      h3   1.10rem
body      0.95rem / 1.6        small  0.80rem / 1.5
numerals  font-variant-numeric: tabular-nums     /* chapter lists, stats, admin tables */
```

Synopsis text caps at ~68 characters per line. Uppercase labels get `0.08em` tracking.

## Layout primitives

- **Page shell** — `max-width: 1440px`, gutters `clamp(1rem, 4vw, 2.5rem)`.
- **Cover grid** — `repeat(auto-fill, minmax(140px, 1fr))`, gap `clamp(.75rem, 2vw, 1.25rem)`.
  Cards are 2:3 via `aspect-ratio`, so the grid never reflows as covers load.
- **Reader column** — `max-width: 820px` centred, `line-height: 0` on the image stack so
  inline-block whitespace can't open hairline gaps between pages.
- **Bottom nav** below 768px; sticky header above it.

Breakpoints: `sm 480 · md 768 · lg 1024 · xl 1280 · 2xl 1536`. Use the defaults throughout.
Asura invents a 900px breakpoint for the header alone, which makes one component's
behaviour untestable against every other component's.

## Components

A small closed set. Every public screen is built from these:

| Component | Notes |
|---|---|
| `SeriesCard` | cover, 2-line clamped title, type chip, latest-chapter pill, optional rank badge |
| `ChapterRow` | number, optional title, relative time, lock / early-access state, read-state |
| `Rail` | horizontally scrolling row with CSS scroll-snap; no carousel library on mobile |
| `Chip` | genre, type, status — one component with a `variant` prop |
| `StatTrio` | rating · chapters · bookmarks, on the series header |
| `Sheet` | bottom sheet on mobile, centred dialog on desktop, one component |
| `Skeleton` | matches the final layout exactly, so hydration shifts nothing |
| `Toast` | with a 10-second undo affordance for destructive actions |
| `EmptyState` | illustration plus one clear action; never a bare "No results" |

**No carousel library on mobile.** `scroll-snap-type: x mandatory` gives native momentum,
correct accessibility, and zero JavaScript. Load Embla-class behaviour only for the desktop
hero, where autoplay and centred scaling are actually wanted.

### Signature treatments

Three places where the theme shows its personality, each earning its cost:

- **Cover-derived backdrop.** The series header blurs and darkens the cover behind the
  content. Extract the dominant colour at ingest and store it, so the backdrop tint is
  server-rendered rather than computed on the client every load.
- **Brand glow on focus states**, via `--glow-brand`. One effect, used consistently, reads as
  designed; the same glow applied to every card reads as noise.
- **New-chapter pulse** on rows updated in the last hour: a single 2s opacity breath on the
  chapter pill, not a running shimmer across the whole row. Disabled under
  `prefers-reduced-motion`.

## Motion

- Durations: 120ms state, 200ms enter/exit, 320ms sheets.
- Easing: `cubic-bezier(.2,0,0,1)` entering, `cubic-bezier(.4,0,1,1)` exiting.
- `prefers-reduced-motion: reduce` collapses everything to opacity and kills all loops.
  A shimmer running on 60 cards is a real problem for vestibular disorders and for battery.
- Animate `transform` and `opacity` only. Never `top`, `left`, `width`.

## Accessibility, as CI checks

- Body text ≥ 4.5:1; the muted ramp is tuned to pass on `--color-surface-2` in both themes.
- Touch targets ≥ 44×44 CSS px. Chapter rows are 56px tall.
- Visible focus: `outline: 2px solid var(--color-brand); outline-offset: 2px`. Never
  `outline: none` without a replacement.
- Reader pages carry real alt text (`"Page 7 of 34"`); the reader is keyboard-navigable and
  the tap-to-toggle zone does not swallow focus.
- `prefers-contrast: more` raises `--color-line` and the muted text ramp.

## Same look, better behaviour

Deliberate departures from the reference. None are cosmetic:

1. **Light theme supported**, because components use tokens rather than literals.
2. **No `body { opacity: 0 }`.** Personalised regions render as skeletons and stream in. The
   page is never invisible, and a JavaScript failure degrades to a readable page instead of
   a blank one — Asura's 3-second failsafe timer is the tell that this can go wrong.
3. **Depth by luminance ramp**, not a border around every panel.
4. **One breakpoint set** across the entire product.
5. **The reader has its own type and spacing scale**, because it is where readers spend 90%
   of their time and the catalog's density is wrong there.
