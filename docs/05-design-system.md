# 05 — Design system (the theme)

The point of going bespoke is to not look like every other site in this space. Madara sites
are instantly recognisable, and so, increasingly, are Asura clones. The layout conventions
below are borrowed because readers expect them; the visual language is deliberately its own.

## Tokens

CSS custom properties on `:root`, consumed by Tailwind v4's CSS-first `@theme`. Dark is the
default and the primary target, but the tokens are structured so a light theme is a token
swap rather than a rewrite — Asura is dark-only, which costs them the ~20% of readers who
prefer light and every reader in daylight.

```css
@theme {
  /* Surface ramp — six steps, not three. Depth comes from luminance, not borders. */
  --color-bg:        oklch(0.16 0.014 285);
  --color-surface-1: oklch(0.20 0.016 285);
  --color-surface-2: oklch(0.24 0.018 285);
  --color-surface-3: oklch(0.29 0.020 285);
  --color-line:      oklch(0.34 0.020 285);
  --color-line-soft: oklch(0.27 0.016 285);

  /* Text ramp */
  --color-fg:        oklch(0.97 0.004 285);
  --color-fg-muted:  oklch(0.74 0.012 285);
  --color-fg-subtle: oklch(0.58 0.014 285);

  /* Brand — pick ONE hue and commit. Teal reads as distinct in a purple-saturated niche. */
  --color-brand:     oklch(0.72 0.15 195);
  --color-brand-ink: oklch(0.18 0.04 195);   /* text on brand */
  --color-brand-dim: oklch(0.40 0.09 195);

  --color-ok:        oklch(0.74 0.15 150);
  --color-warn:      oklch(0.80 0.15  75);
  --color-danger:    oklch(0.65 0.19  25);

  /* Radii, spacing rhythm, elevation */
  --radius-sm: 6px;  --radius-md: 10px;  --radius-lg: 16px;  --radius-full: 999px;
  --shadow-1: 0 1px 2px oklch(0 0 0 / .35);
  --shadow-2: 0 8px 24px -8px oklch(0 0 0 / .55);

  --font-display: "Clash Display", ui-sans-serif, system-ui, sans-serif;
  --font-body:    "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono:    ui-monospace, "JetBrains Mono", monospace;
}
```

Everything is in **OKLCH**, which is why the ramps look evenly spaced. Sibling steps in
hex tend to bunch in the midtones; OKLCH lightness is perceptually uniform, so
`0.20 → 0.24 → 0.29` genuinely reads as three even steps.

### Semantic colours

Type and status colours are tokens, not values sprinkled through components:

```css
--type-manga:  oklch(0.62 0.16 250);
--type-manhwa: oklch(0.62 0.17  25);
--type-manhua: oklch(0.62 0.13 165);
--status-ongoing:   var(--color-brand);
--status-completed: var(--color-ok);
--status-hiatus:    var(--color-warn);
--status-cancelled: var(--color-fg-subtle);
```

## Typography

Two families, not three. A condensed display face for headings and numerals (chapter
numbers, ranks, ratings — the places where density matters), a variable sans for body.

Self-host both as **subset woff2** with `font-display: swap` and a `<link rel="preload">`
for the two faces above the fold. Do not use an automatic font proxy: Asura's login page
ships roughly 120 unicode-range subsets of a Japanese face to render a page containing no
Japanese. Subset to `latin` + `latin-ext` and add other ranges only where you actually
render them (alternative titles are the one place that genuinely needs CJK — load it there,
lazily, scoped to that component).

Scale, fluid via `clamp()`:

```
display  clamp(2.0rem, 1.4rem + 3vw, 3.5rem)   /* series title on the hero */
h1       clamp(1.6rem, 1.3rem + 1.4vw, 2.2rem)
h2       1.35rem   h3  1.1rem
body     0.95rem / 1.6      small  0.8rem / 1.5
```

Body at 0.95rem with 1.6 line-height, capped at ~68 characters per line for synopsis text.

## Layout primitives

- **Page shell** — `max-width: 1440px`, gutters `clamp(1rem, 4vw, 2.5rem)`.
- **Series grid** — `repeat(auto-fill, minmax(140px, 1fr))`, gap `clamp(0.75rem, 2vw, 1.25rem)`.
  Cards are 2:3 with `aspect-ratio`, so the grid never reflows as covers load.
- **Reader column** — `max-width: 820px` centred, `line-height: 0` on the image stack so
  inline-block whitespace can't open hairline gaps between pages.
- **Bottom nav** on mobile below 768px; sticky header above it.

Breakpoints: `sm 480 · md 768 · lg 1024 · xl 1280 · 2xl 1536`. Use the defaults. Asura
invents a 900px breakpoint just for the header, which means one component's behaviour is
untestable against every other component's breakpoints.

## Components

A small, closed set. Every screen in the product is built from these:

| Component | Notes |
|---|---|
| `SeriesCard` | cover, title (2-line clamp), type chip, latest-chapter pill, optional rank badge |
| `ChapterRow` | number, optional title, relative time, lock/early-access state, read/unread |
| `Rail` | horizontally scrolling row with snap points; CSS scroll-snap, no carousel library on mobile |
| `Chip` | genre, type, status — one component, `variant` prop |
| `StatTrio` | rating / chapters / bookmarks, used on series header |
| `Sheet` | bottom sheet on mobile, centred dialog on desktop — same component |
| `Skeleton` | matches final layout exactly, so hydration doesn't shift anything |
| `Toast` | with a 10s undo affordance for destructive actions |
| `EmptyState` | illustration + one clear action; never a bare "No results" |

**No carousel library on mobile.** CSS `scroll-snap-type: x mandatory` gives native momentum,
correct accessibility, and zero JavaScript. Load Embla-class behaviour only for the desktop
hero, where you actually want autoplay and centred scaling.

## Motion

- Durations: 120ms (state), 200ms (enter/exit), 320ms (sheets and page transitions).
- Easing: `cubic-bezier(0.2, 0, 0, 1)` for entering, `cubic-bezier(0.4, 0, 1, 1)` for exiting.
- Respect `prefers-reduced-motion: reduce` — collapse everything to opacity, kill the
  shimmer loops entirely. Animated shimmer on a list of 60 cards is a genuine problem for
  vestibular disorders and for battery.
- Never animate `top`/`left`/`width`. `transform` and `opacity` only.

## Accessibility, as constraints

These are checks in CI, not aspirations:

- Body text ≥ 4.5:1 contrast; the muted ramp is tuned to pass on `--color-surface-2`.
- Every interactive target ≥ 44×44 CSS px on touch.
- Visible focus ring: `outline: 2px solid var(--color-brand); outline-offset: 2px`. Never
  `outline: none` without a replacement.
- Reader pages carry real `alt` text (`"Page 7 of 34"`), and the reader is keyboard-navigable.
- The chrome-toggle tap zone in the reader does not swallow keyboard focus.
- `prefers-contrast: more` bumps `--color-line` and the muted text ramp.

## What is deliberately different from Asura

Not decoration — each of these is a behavioural improvement:

1. **Light theme supported.** Tokens, not hard-coded hex.
2. **No `body { opacity: 0 }`.** Personalised regions render as skeletons and stream in;
   the page is never invisible, and a JS failure degrades to a readable page rather than a
   blank one.
3. **Depth by luminance ramp**, not by drawing a border around every panel.
4. **One breakpoint set** across the whole product.
5. **Reader-first type sizing** — the reader gets its own scale, since it is where users
   spend 90% of their time and where the rest of the site's density is wrong.
