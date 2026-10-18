# Credit page faces

The two display faces the credit card can be set in (docs/03, Admin → Appearance → Credit
page). They are installed into the image by `infra/Dockerfile` and resolved by fontconfig at
render time, the same way the watermark resolves DejaVu.

They live in the repository rather than being fetched at build time for one reason: librsvg
fails **silently** on a missing face. It draws an empty layer, so a build that could not reach
a font host would produce credit pages with no names on them and no error anywhere. A file in
the tree cannot fail to download.

| File | fontconfig family | Notes |
| --- | --- | --- |
| `anime-ace-italic.ttf` | `Anime Ace` | Comic lettering. Caps-only in practice; no accented glyphs, which fontconfig fills from DejaVu per glyph. |
| `vampire-wars-italic.ttf` | `Vampire Wars` | Narrower and heavier. Carries Latin-1 accents. |

Each is a single italic cut. `apps/web/lib/credit/layout.ts` therefore asks for no weight or
slant on them — a synthesised bold on a hand-lettered face reads as a rendering fault — and
carries a measured average glyph width per family, which is what every wrap and shrink-to-fit
decision on the card is made of. **A new face needs measuring before it is added**: render it
at 100px, trim to the ink, and divide by the character count.
