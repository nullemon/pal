# PALScans — reader and admin mockup brief (v2)

Read `BRIEF.md` in this directory FIRST: its §2 (brand, catalog, series and reader subject),
§3 (craft rules) and §4 (exact file format) apply in full here. This file adds what is
specific to the reader set.

## Why v2

The first reader mockups were rejected. What the operator wants, in their words: "1 page
either all load together in 1 vertical line top to bottom, or 1 at a time which they can
click and load as they go, like cubari.moe" — plus ad space: sticky skyscrapers left and
right on desktop, and on mobile an ad after every 2 or 4 pages, configurable in admin.

The reader is chrome around artwork. It must look like a real, shipped reader — the kind
where the interface disappears and the pages are the point.

## Palette and type (shared by every artboard in this set)

Neutral dark violet so it fits any homepage direction: page/background **#0b0a10**, chrome
bars **rgba(16,13,23,.94)** with a 1px **#2c2540** hairline, raised **#181423**, text
**#ece9f4**, muted **#9e97b8**, accent **#8b5cf6** (hover #a78bfa), gold #f2c14e.
Font: **Plus Jakarta Sans** (Google Fonts) 400/500/600/700, system-ui fallback.
Icons: inline SVG, 24px grid, 1.75px stroke, round caps. No emoji.

## Drawing pages

Pages are the artwork. Draw each page as a `<div>` of the page's real proportions
(**page width × 1.42** tall for a typical scanned page; long-strip webtoon panels may be
taller) with a soft dark-grey gradient (`linear-gradient(180deg,#1a1626,#14111f)`), a
1px inner border `rgba(255,255,255,.05)`, and inside it two or three faint rectangles
suggesting comic panels (`rgba(255,255,255,.04)` fills, `rgba(255,255,255,.08)` borders).
Label ONE visible page with a small muted "7 / 34" in its lower-right corner. Do not use
cover images as pages. Pages in a strip touch: **zero gap, zero radius**.

## Ad placements in the reader

Draw every slot as a dashed 1px `#3a3152` box on `rgba(31,26,44,.45)` with a centred
muted small-caps label at exactly the stated size:

| Where | Slot | Label text |
|---|---|---|
| Desktop, both sides of the reading column | 160×600, vertically centred, sticky | `AD · Skyscraper 160×600 · sticky` |
| Mobile, inside the strip after every N pages | 300×250 centred on a full-width dark band 24px padding | `AD · 300×250 · after every 4 pages` |
| Any device, after the last page, before the Next Chapter control | 336×280 (desktop) / 300×250 (mobile) | `AD · End of chapter 336×280` |

Premium readers see none of them; that is a setting, not a mockup concern.

## Artboards

Frames are exact root sizes (inline `width` + `min-height`, explicit background):

| File | Frame | What it shows |
|---|---|---|
| `ReaderStripDesktop.dc.html` | 1440 × 1000 | **Long strip, desktop.** Reading column 820 wide centred with pages stacked (show 2 full pages and the start of a third). Top bar 56px: back chevron · "Return of the Frost Monarch" + "Chapter 301" · right side: "7 / 34" counter, settings gear, comments icon. Thin 3px violet progress bar under the top bar (~20% filled). Bottom bar 60px: Prev · "Chapter 301 ▾" · Next centred, 44px buttons. Skyscrapers left and right in the gutters, vertically centred. |
| `ReaderPagedDesktop.dc.html` | 1440 × 1000 | **Paged, desktop (cubari-style).** Pure #0b0a10. One page fit-to-height centred (page height ≈ 860, width ≈ 605). Top bar 48px, translucent: back chevron · series title · two selects side by side: "Chapter 301 ▾" and "Page 7 / 34 ▾" · settings gear. Faint hover click zones: the left and right 30% of the page area with a barely visible chevron each (draw them at 8% opacity). Bottom: a 2px scrubber track with 34 tick marks, the 7th highlighted violet, and a tiny "← → to turn · F fullscreen · S strip mode" hint in muted 12px text. Skyscrapers left and right. |
| `ReaderImmersiveDesktop.dc.html` | 1440 × 1000 | **Long strip, chrome hidden.** Same column as ReaderStripDesktop, but no bars: only a floating glass pill bottom-centre (Prev · Chapter 301 ▾ · Next, 56px, `backdrop-filter: blur(16px)`, 1px hairline, radius 999px) and a 3px progress bar at the very top. A small muted hint top-right: "H · show controls". Skyscrapers left and right remain. |
| `ReaderStripMobile.dc.html` | 390 × 1700 | **Long strip, mobile, with the ad interval.** Top bar 52px as desktop but compact. Then pages full width, zero gap: page 5, 6, 7, 8 (each 390 wide × ~330 tall so four fit), then the in-strip ad band (`AD · 300×250 · after every 4 pages`), then pages 9 and 10 (page 9 partly, page 10 cut by the frame bottom). Bottom bar 60px pinned at the frame bottom: Prev · "Chapter 301 ▾" · Next. |
| `ReaderPagedMobile.dc.html` | 390 × 844 | **Paged, mobile.** One page fit-to-width (390 × 554) vertically centred on #0b0a10. Top bar 52px: back · "Frost Monarch · Ch. 301" · settings. A first-run overlay drawn at 40% opacity dividing the page into three tap zones with labels "Previous" (left 30%), "Menu" (centre), "Next" (right 30%). A floating "7 / 34" counter pill bottom-centre above a 2px scrubber. Bottom bar 60px: Prev · Chapter 301 ▾ · Next. |
| `ReaderSettingsMobile.dc.html` | 390 × 844 | **Reader settings sheet, mobile.** The paged reader dimmed behind; a bottom sheet (radius 20px top corners, #181423, handle bar) 620 tall with rows: **Mode** segmented control — Long strip · Single page · Double page (Single selected) · **Direction** — Left to right · Right to left · **Fit** — Width · Height · Original · **Quality** — Auto · High · Saver · **Preload** — 3 · 5 · 10 pages · **Background** — four swatches black / dark / sepia / white · a final row "Remove ads and unlock early access" with a violet **Go Premium** button. Every control ≥ 44px tall. |
| `AdminLayouts.dc.html` | 1440 × 1000 | **Admin → Appearance → Layouts.** Light-on-dark admin shell: a 240px left nav (PALScans mark, groups Dashboard · Content · Community · Business · System, with "Appearance › Layouts" active), a top bar with breadcrumb "Appearance / Layouts" and a violet **Save changes** button. Content: three cards. **Homepage layout** — six radio cards in a row, each a 150×100 mini-thumbnail (draw as abstract grey blocks suggesting hero + grid + sidebar) with the direction name beneath: A Violet Classic · B Violet Refined · C Editorial Noir · D Catalog Grid · E Daylight · F Cinematic Rows; **A selected** with a violet ring and a "Live" pill; a small "Preview" link on each. **Series page layout** — same six, **B selected**. **Reader** — a row of controls: *Default mode* segmented (Long strip · Paged), *Desktop skyscrapers* toggle ON with size select "160×600 ▾", *Mobile in-strip ad every* segmented (Off · 2 · 4 · 6 pages, 4 selected), *End-of-chapter slot* toggle ON. A muted note under the cards: "Changes apply on save and purge the page cache — no deploy needed." |

## Craft, again

Hi-fi. Real copy from BRIEF.md only. No lorem, no emoji, no scripts, all tags closed,
attributes double-quoted, flex/grid with gap for every sibling group, touch targets ≥ 44px
on mobile, and file size under ~90 KB each. Re-read every file once before you finish and
fix anything off-brief. Return a manifest: file paths, sizes, one sentence on what each shows.
