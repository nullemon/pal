/**
 * The built-in mark, as two path definitions.
 *
 * "Balloon P": the P's bowl squared off into a speech balloon and given a gold tail — the
 * `11-balloon-p` direction from `design/logos/`, and what the site shows when the operator has
 * chosen no logo of their own (docs/15 "Brand and identity").
 *
 * It is drawn in three places that cannot share a component — the site header, the admin
 * sidebar and the OG share card, which is rasterised by satori and so cannot use Tailwind
 * classes — and each needs its own colours: the header follows the operator's accent, the
 * sidebar uses a lighter tile against its dark ground, and the card is fixed brand-purple.
 * Sharing the geometry and nothing else is what keeps the three from drifting; `preset-art`
 * carries a fourth copy inside a design file, and `monogram.test.ts` pins it to these.
 *
 * On the 512 grid the other ten directions use. Stem 58, cap height 276, walls a constant
 * 56–58, tail falling the depth of the stem into the empty quarter beside it.
 */

/** The letter, `fill-rule="evenodd"` — the second subpath is the counter. */
export const MONOGRAM_LETTER =
  'M150 118 H302 A62 62 0 0 1 364 180 V224 A62 62 0 0 1 302 286 H208 V394 H150 Z M208 174 H278 A28 28 0 0 1 278 230 H208 Z'

/** The balloon tail. Gold — the one accent, and the detail that survives favicon size. */
export const MONOGRAM_TAIL = 'M232 286 H296 L236 372 Z'

/** The tile's corner radius on the same grid, so all three copies round identically. */
export const MONOGRAM_RADIUS = 112
