import 'server-only'
import type { ResolvedCredit } from '@palscans/core/credit'
import type { Storage } from '@palscans/core/storage'
import sharp from 'sharp'

/**
 * Compose one credit page: background, overlay, text (docs/03).
 *
 * Rendered rather than stored. The note is per chapter, so a stored card would be one image
 * per chapter forever — and the chapters this site mostly carries store *nothing*, their
 * pages living on the host they were imported from. Composing on demand keeps that true: the
 * result is cached at the edge by its own route and the bucket stays empty.
 *
 * The text is drawn as SVG rather than with a canvas. `sharp` composites SVG natively, it is
 * the only text rasteriser already in this image, and an SVG layer is inspectable — a
 * mis-measured line is visible in the markup instead of hidden in a draw call.
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
const LAYOUT = {
  /** Six value boxes beside the printed role names. */
  rows: { firstY: 0.391, stepY: 0.0452, x: 0.787, size: 0.0245, max: 6 },
  /** The NOTES box: a few lines, left-aligned, inside the cream panel. */
  /**
   * The NOTES panel is shallow — about a tenth of the card — so the type is small and the
   * leading tight. Rendered once against the real artwork, the first attempt put the fourth
   * line below the panel entirely; these numbers keep four lines inside it with margin.
   */
  note: { top: 0.714, left: 0.668, right: 0.968, size: 0.017, lineHeight: 1.36, maxLines: 4 },
  /** The two LINKS boxes, beside their printed captions. */
  // Slightly smaller than it looks like it needs to be: `palscans.org/discord` is the
  // longest value either box will hold and at 0.0215 it ran to the very edge of its frame.
  links: { discordY: 0.8905, twitterY: 0.9365, x: 0.792, size: 0.0195 },
} as const

/**
 * The boxes are cream, so the text in them is near-black.
 *
 * White text was the first guess and it would have been invisible: every field this renderer
 * fills sits inside a pale panel. Not pure black — the artwork is ink-on-paper and a true
 * #000 reads as a sticker on top of it.
 */
const INK = '#16161a'

/** XML-escape. The values are operator-entered and go into an SVG document. */
const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/**
 * Break a note into lines that fit the box.
 *
 * Measured by character count against an average glyph width rather than by real metrics:
 * `sharp` gives no text measurement API, and the alternative — shelling out to a font
 * library — is a dependency for a card with four lines on it. The estimate is deliberately
 * conservative, so a long note wraps early rather than running past the edge of the box.
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

const textLayer = (credit: ResolvedCredit, width: number, height: number): Buffer => {
  const w = (f: number) => Math.round(f * width)
  const h = (f: number) => Math.round(f * height)

  /**
   * Handles only — the role names are printed on the overlay.
   *
   * Taken in order and capped at the number of boxes the artwork has. A seventh role would
   * otherwise be drawn below the last box, over the NOTES header.
   */
  const rows = credit.roles
    .slice(0, LAYOUT.rows.max)
    .map(
      (role, i) =>
        `<text x="${w(LAYOUT.rows.x)}" y="${h(LAYOUT.rows.firstY) + i * h(LAYOUT.rows.stepY)}" class="handle">${esc(role.handle)}</text>`,
    )
    .join('')

  const noteSize = h(LAYOUT.note.size)
  const noteWidth = w(LAYOUT.note.right - LAYOUT.note.left)
  /**
   * ~0.56em per character, measured rather than guessed.
   *
   * 0.5 was the first estimate and it overflowed: a 46-character line of DejaVu Sans italic
   * ran about 8px past the panel on the real card. Erring wide is the wrong direction here —
   * there is no clipping, so a line that does not fit simply prints over the artwork.
   */
  const noteChars = Math.max(12, Math.floor(noteWidth / (noteSize * 0.56)))
  const note = wrapNote(credit.note, noteChars, LAYOUT.note.maxLines)
    .map(
      (line, i) =>
        `<text x="${w(LAYOUT.note.left)}" y="${h(LAYOUT.note.top) + i * Math.round(noteSize * LAYOUT.note.lineHeight)}" class="note">${esc(line)}</text>`,
    )
    .join('')

  const link = (value: string, y: number) =>
    value.trim() === ''
      ? ''
      : `<text x="${w(LAYOUT.links.x)}" y="${h(y)}" class="link">${esc(value)}</text>`

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <style>
        text { font-family: 'DejaVu Sans', sans-serif; fill: ${INK}; dominant-baseline: middle; }
        .handle { font-size: ${h(LAYOUT.rows.size)}px; font-weight: 700; }
        .note { font-size: ${noteSize}px; font-style: italic; }
        .link { font-size: ${h(LAYOUT.links.size)}px; font-weight: 600; }
      </style>
      ${rows}${note}${link(credit.discord, LAYOUT.links.discordY)}${link(credit.twitter, LAYOUT.links.twitterY)}
    </svg>`,
  )
}

/**
 * Render the card. Returns null when a piece it cannot do without is missing from storage.
 *
 * Null rather than a half-drawn card: a credit page whose overlay failed to load is text on
 * a photograph, which looks like a broken page rather than an absent feature. The caller
 * answers 404 and the chapter simply has no credit page, which is the safe way to fail.
 */
export const renderCreditPage = async (
  credit: ResolvedCredit,
  storage: Storage,
): Promise<Buffer | null> => {
  if (!credit.overlayKey) return null
  const overlayBytes = await storage.get(credit.overlayKey).catch(() => null)
  if (!overlayBytes) return null

  /**
   * The card takes the overlay's own dimensions.
   *
   * The artwork decides the shape — the supplied one is 4:3 landscape — and a replacement may
   * be anything. Resizing it to a fixed canvas would distort the frame or letterbox it inside
   * itself, and every coordinate above is a fraction precisely so this can vary.
   */
  const overlayImage = sharp(Buffer.from(overlayBytes))
  const meta = await overlayImage.metadata().catch(() => null)
  const width = meta?.width && meta.width > 0 ? meta.width : CREDIT_WIDTH
  const height = meta?.height && meta.height > 0 ? meta.height : CREDIT_HEIGHT

  // The background is optional — the overlay may be opaque everywhere — so a missing one
  // falls back to ink rather than failing the render.
  const backgroundBytes = credit.backgroundKey
    ? await storage.get(credit.backgroundKey).catch(() => null)
    : null

  const base = backgroundBytes
    ? sharp(Buffer.from(backgroundBytes))
        // `cover`, so a background of any aspect fills the window the overlay leaves for it
        // without bars showing inside the frame.
        .resize(width, height, { fit: 'cover', position: 'centre' })
    : sharp({ create: { width, height, channels: 3, background: '#0b0b0f' } })

  const overlay = await overlayImage.resize(width, height, { fit: 'fill' }).png().toBuffer()

  return base
    .composite([
      { input: overlay, top: 0, left: 0 },
      // Text last: it belongs on top of the frame, not under it.
      { input: textLayer(credit, width, height), top: 0, left: 0 },
    ])
    .jpeg({ quality: 90, progressive: true })
    .toBuffer()
}
