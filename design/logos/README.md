# PALScans — ten logo directions

Ten different marks for palscans.org, not ten versions of one. Each is a hand-written SVG on a
512 grid with a transparent ground, using only `--color-brand` `#7c3aed`, `--color-gold`
`#f5c451` and white. No gradients, no strokes, no effects — every mark is solid fills, so it
survives being scaled, single-colour printed, or handed to the Appearance resolver in
`docs/15-appearance.md`.

Start with `sheets/00-contact-sheet.png`. Each concept then has its own sheet showing 512 / 64 /
16 px on `#100d17` and on white, with hard-pixel zooms of the two small sizes, plus the circular
avatar, the maskable square with the 80% safe zone drawn on, and the `PALScans` lockup.

## Regenerating the PNGs

```
node design/logos/render.mjs
```

Edit an SVG, run that, and every sheet in `sheets/` is rebuilt. It resolves `sharp` from the
workspace (falling back to a scan of `node_modules/.pnpm`), so `pnpm install` at the repo root
is the only prerequisite. It writes nothing outside `design/logos/sheets/`.

## What is in here

| file | what it is |
| --- | --- |
| `01-…svg` – `10-…svg` | the ten concepts, 512 × 512, transparent |
| `wordmark.svg` | `PALScans` outlined from Archivo ExtraBold + Regular, `currentColor`, used for every lockup |
| `render.mjs` | rebuilds `sheets/` |

The wordmark is outlined rather than set as live text, so the files carry no font dependency.

---

## 01 — Panel Cut

A geometric `P` — 56px stem, 256px cap height — knocked out of the brand tile and then split by
a 24px gutter dropped exactly on the stem's right edge, so the stem stays a clean bar and the
bowl becomes a separate panel. It is the one direction that keeps the site's existing letter
while giving it a reason to exist: the gutter is the single most manga-specific mark there is,
and at favicon size the gutter closes and it degrades gracefully into a plain solid `P`.
**Weakest point:** it is still a letter in a rounded square, which is the most crowded shape on
the internet — it will sit next to a dozen identical tiles in a browser tab strip, and the
gutter that makes it ours is exactly the detail that vanishes first.

## 02 — Dog-Ear

A page with the corner turned down and a panel gutter across it, drawn as three separate solids
so the crease and the gutter are real negative space rather than lines. One colour, no
container, identical on any ground. Reading is the whole product, and the dog-ear says "the
place you stopped" without a single literal book. It is the most editorial of the ten and would
carry a premium reading site.
**Weakest point:** a portrait page uses very little of a square canvas, so at 16px it is a small
narrow bar with a faint diagonal — the least *present* of the ten in a tab. And "page with a
folded corner" is the default file-manager icon; it needs the wordmark next to it to stop
reading as generic document software.

## 03 — Twin Bookmark

Two ribbons at different depths: the chapter you are on, and the one you saved. Nothing in the
mark is thinner than 124px at 512, so it is by some distance the most robust of the set — at
16px you still see two notched tabs. Ribbons are also the one library metaphor a young audience
reads instantly, without any "old books" connotation.
**Weakest point:** it is the least distinctive idea here. Bookmark logos are everywhere, and
two-instead-of-one is a thin differentiator that most viewers will never consciously register.
It is safe rather than interesting.

## 04 — Panel Grid

A manga page: one tall panel, two stacked panels, and a raked gutter breaking the grid the way
an action beat does. Sharp corners on purpose — real panels are not rounded. Gutters are a
constant 26px. This is the only mark that is unmistakably *comics* rather than *reading*, and
the rake gives it movement without any motion cliché.
**Weakest point:** stripped of the rake it is a dashboard/layout icon, and at 16px the rake is
the first thing to blur out — so the size where it most needs its personality is the size where
it has least. It also reads faintly as a lowercase `h`.

## 05 — Speed Slash

Three speed lines raked 32°, clipped by the tile, bars 52px on a 34px gutter, with the short one
carrying the gold so the white reading stays dominant. This is the sharpest, youngest mark of
the ten and the one that will hold up best against a page full of cover art — it has real
velocity and it survives 16px almost intact.
**Weakest point:** three diagonal bars is also the shape of a hamburger menu, a sort control and
several well-known SaaS logos. Nothing about it is specific to manga except the intention, and
it is the only concept whose reading depends on the gold accent, which is the least
ground-agnostic colour in the palette.

## 06 — Scan Pass

A page caught mid-scan: solid where the pass has finished, breaking into raster lines below it,
with the gold beam sweeping the whole disc at the boundary. The beam sits in the page's own
gutter so gold never overlaps white. This is the most literal answer to what the site actually
is — a scanlation library — and the disc gives the set a second silhouette alongside the rounded
squares.
**Weakest point:** it is the busiest mark here. At 16px the page dissolves and you are left with
a purple dot and a gold line, which is memorable but no longer says "page". It also needs three
colours to work, where most of the others need one.

## 07 — Bracket Tag

The square-bracket group tag that has sat in front of scanlation release filenames for twenty
years, with a raw page tucked inside it and tilted 6° so it does not look filed. This is the
concept that talks directly to the audience that grew up on `[Group] Series - c001.zip`; nobody
outside that world will decode it, and that is the point. One colour, three solids, 38px bracket
weight.
**Weakest point:** the tilted slab inside is doing a lot of work at 512 and none at 16px, where
the mark collapses into three vertical smudges. It also inherits the ambiguity of brackets
themselves — at a glance it can read as a phone, an ID badge or a code snippet.

## 08 — Balloon Pal

Mascot. A speech balloon read as a face: the tail is the chin, the eyes are the only detail, and
every feature is true negative space so it inverts for free. "PAL" is a friendliness the other
nine concepts never cash in on, and a face is the single most memorable thing you can put in an
avatar slot — this is the one people would actually make emotes out of.
**Weakest point:** it is the least serious, and the balloon-with-a-face silhouette is very close
to what every chat and community product uses — it may read as "comments" rather than "comics".
The smile is gone by 24px and the eyes are two dots at 16px.

## 09 — Stacked Wordmark

No mark at all: Archivo ExtraBold `PAL` over Archivo Medium `SCANS` tracked +200/1000, both set
optically to the same 336px measure and joined by a rule. It is the most grown-up thing in the
set, it needs no explanation, and it is the only option that spends its whole budget on the
name — which for a site people find by typing the name is a defensible choice.
**Weakest point:** it fails the 16px test outright and I would not ship it alone. At favicon
size it is an unreadable smear, and the circular avatar crops it uncomfortably. It only works if
the site also commissions a separate reduction mark, which means this is really half a solution.

## 10 — Aperture

A geometric badge whose negative space is a reader's eye — equally a manga eye and a scanner
aperture. Octagon with a 94px chamfer, and the lens is cut rather than drawn, so the ground
shows through and the mark needs only one ink. The octagon reads as a badge without any of the
ribbon-and-laurel baggage, and it holds its shape better than a circle at small sizes.
**Weakest point:** the pupil is gone by 20px, leaving an eye-shaped slot, and an eye mark on a
site that tracks what you read carries an unwanted surveillance overtone. The octagon is also
close enough to a stop-sign silhouette to feel faintly cautionary.

---

## Notes on the constraints

- **Gold never stands alone.** `#f5c451` is 1.6:1 against white, so in 05 and 06 it only ever
  appears inside a purple container. Any concept using gold outside one would break on a light
  theme.
- **Brand purple on the two grounds.** `#7c3aed` is 5.7:1 on white and 3.4:1 on `#100d17` —
  above the 3:1 floor for non-text, which is why the container-less marks (02, 03, 04, 07, 08,
  09, 10) can be a single ink and still work on both.
- **Maskable.** 01, 05 and 06 own their container and are rendered full-bleed. The rest are
  free-standing glyphs and are placed at 80% on a ground; the sheets show them that way with the
  safe circle and square drawn on top.
- **16px.** 03, 05 and 01 pass cleanly. 04, 07 and 10 survive as a simplified silhouette. 02 and
  06 lose their story but stay identifiable. 08 becomes a face-shaped blob. 09 does not pass.
