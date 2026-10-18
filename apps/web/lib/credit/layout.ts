import type { CreditFont } from '@palscans/core/credit'

/**
 * Where the credit card's text goes, and how wide it comes out (docs/03).
 *
 * Separate from `render.ts` because none of it needs `sharp` or a storage client: these are
 * the measurements, and measurements are the part that is worth pinning in tests. The
 * renderer composites; this decides where and how big.
 */

/**
 * Fallback size, used only when the overlay's own dimensions cannot be read.
 *
 * The real size comes from the overlay itself (see `renderCreditPage`): the supplied card is
 * 4:3 landscape, a replacement may be any shape, and hardcoding a square would letterbox
 * every one of them inside its own frame.
 */
export const CREDIT_WIDTH = 1456
export const CREDIT_HEIGHT = 1088

/**
 * Where the text goes, as fractions of the overlay.
 *
 * Measured against the supplied card. Fractions rather than pixels so a higher-resolution
 * re-export of the same design keeps landing in the same boxes.
 *
 * Note what is *not* here: the role labels, and the `Discord:` / `Twitter/X:` captions. Those
 * are drawn into the overlay artwork, so this only fills the empty boxes beside them. The
 * labels in the settings are the operator's own reference for which row is which.
 */
export const LAYOUT = {
  /** Six value boxes beside the printed role names. */
  rows: { firstY: 0.391, stepY: 0.0452, x: 0.787, right: 0.968, size: 0.0245, max: 6 },
  /**
   * The NOTES box: a few lines, left-aligned, inside the cream panel.
   *
   * The panel is shallow — about a tenth of the card — so the type is small and the leading
   * tight. Rendered once against the real artwork, the first attempt put the fourth line
   * below the panel entirely; these numbers keep four lines inside it with margin.
   */
  note: { top: 0.714, left: 0.668, right: 0.968, size: 0.017, lineHeight: 1.36, maxLines: 4 },
  /** The two LINKS boxes, beside their printed captions. */
  links: { discordY: 0.8905, twitterY: 0.9365, x: 0.792, right: 0.968, size: 0.0195 },
} as const

/**
 * What a face costs in width, and how big it wants to be set.
 *
 * `em` is the width of an average character as a fraction of the font size, and it is
 * *measured*, not guessed: each face was rendered at 100px and the result trimmed to its ink.
 * It is what every fit and wrap decision below is made of, which is why a face cannot simply
 * be named here without being measured first — the comic faces run a third wider than a text
 * face at the same size, and a card set from the wrong number prints over its own frame.
 *
 * `scale` brings a face back to the size the boxes were measured at. Display faces carry much
 * more ink per em than DejaVu, so the same pixel size reads considerably larger.
 */
export interface FontMetrics {
  /** The fontconfig family name. Must match a face installed in the image — see infra/Dockerfile. */
  family: string
  /** Measured width of an average character, in ems. */
  em: number
  /** Multiplier on every font size in `LAYOUT`. */
  scale: number
  /**
   * Whether to ask for bold handles and an italic note.
   *
   * Only for the text face. The two comic faces ship one cut each and it is already italic,
   * so asking for a weight or a slant they do not have gets a *synthesised* one — pango
   * smears the outline sideways, which on a hand-lettered face reads as a rendering fault
   * rather than emphasis.
   */
  synthesise: boolean
}

export const FONTS: Record<CreditFont, FontMetrics> = {
  // Blambot's comic lettering face. Caps-only in practice — its lowercase draws as small
  // capitals — which is why its measured em is so far above a text face's.
  'anime-ace': { family: 'Anime Ace', em: 0.77, scale: 0.86, synthesise: false },
  // Narrower and heavier; fits more per line at the cost of some legibility at note size.
  'vampire-wars': { family: 'Vampire Wars', em: 0.58, scale: 0.9, synthesise: false },
  // The face the rest of the image already has, and the one thing here that cannot go
  // missing — so it is also what a card falls back to.
  plain: { family: 'DejaVu Sans', em: 0.56, scale: 1, synthesise: true },
}

export const fontMetrics = (font: CreditFont): FontMetrics => FONTS[font] ?? FONTS.plain

/**
 * Shrink a single-line value until it fits its box.
 *
 * The boxes on the card are fixed and the values are not: `palscans.org/discord` already fills
 * its frame to the edge, and a longer handle or a club with a longer invite would run straight
 * out of it and over the artwork. There is no clipping in an SVG text node, so the only way a
 * value cannot overflow is to have been sized so that it does not.
 *
 * Never below `MIN_SIZE` — a thirty-character handle shrunk to fit would be unreadable, and
 * one that overhangs slightly is the better failure.
 */
export const MIN_SIZE = 9

export const fitSize = (text: string, boxWidth: number, size: number, em: number): number => {
  const chars = text.trim().length
  if (chars === 0 || boxWidth <= 0) return size
  return Math.max(MIN_SIZE, Math.min(size, Math.floor(boxWidth / (chars * em))))
}

/**
 * Break a note into lines that fit the box.
 *
 * Measured by character count against the face's average glyph width rather than by real
 * metrics: `sharp` gives no text measurement API, and the alternative — shelling out to a font
 * library — is a dependency for a card with four lines on it. `em` is the widest of the three
 * strings measured for that face, so a note wraps early rather than running past the edge.
 */
export const wrapNote = (text: string, maxChars: number, maxLines: number): string[] => {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= maxChars) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = word
    if (lines.length === maxLines) break
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length > maxLines) lines.length = maxLines
  // A note that did not fit is cut with an ellipsis rather than silently losing its end —
  // the operator can see it was truncated and shorten it themselves.
  const last = lines.at(-1)
  if (last && words.join(' ').length > lines.join(' ').length)
    lines[lines.length - 1] = `${last.replace(/[.,;:]$/, '')}…`
  return lines
}
