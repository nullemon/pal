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

/** The card is square, matching the supplied overlays. */
export const CREDIT_SIZE = 1200

/**
 * Everything the renderer draws, in overlay-relative coordinates.
 *
 * Expressed as fractions of the canvas, not pixels: the overlays are supplied as square
 * images and an operator may replace them with a larger export, which must not move the text
 * off the boxes it is meant to sit in.
 */
const LAYOUT = {
  roles: { top: 0.14, left: 0.47, right: 0.94, rowHeight: 0.054, size: 0.028 },
  note: { top: 0.72, left: 0.08, right: 0.92, size: 0.0225, lineHeight: 1.45 },
  footer: { y: 0.955, size: 0.021 },
} as const

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

const textLayer = (credit: ResolvedCredit, size: number): Buffer => {
  const px = (fraction: number) => Math.round(fraction * size)
  const rows = credit.roles
    .map((role, i) => {
      const y = px(LAYOUT.roles.top) + i * px(LAYOUT.roles.rowHeight)
      return [
        `<text x="${px(LAYOUT.roles.left)}" y="${y}" class="role" text-anchor="end">${esc(role.label)}</text>`,
        `<text x="${px(LAYOUT.roles.left) + px(0.03)}" y="${y}" class="handle">${esc(role.handle)}</text>`,
      ].join('')
    })
    .join('')

  const noteLines = wrapNote(credit.note, 58, 4)
  const note = noteLines
    .map(
      (line, i) =>
        `<text x="${px(LAYOUT.note.left)}" y="${px(LAYOUT.note.top) + i * Math.round(px(LAYOUT.note.size) * LAYOUT.note.lineHeight)}" class="note">${esc(line)}</text>`,
    )
    .join('')

  const footer = [credit.discord, credit.twitter].filter((v) => v.trim() !== '')
  const footerText = footer.length
    ? `<text x="${px(0.5)}" y="${px(LAYOUT.footer.y)}" class="footer" text-anchor="middle">${esc(footer.join('   |   '))}</text>`
    : ''

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <style>
        text { font-family: 'DejaVu Sans', sans-serif; fill: #ffffff; dominant-baseline: middle; }
        .role { font-size: ${px(LAYOUT.roles.size)}px; font-weight: 700; letter-spacing: ${px(0.0012)}px; }
        .handle { font-size: ${px(LAYOUT.roles.size)}px; font-weight: 700; }
        .note { font-size: ${px(LAYOUT.note.size)}px; font-style: italic; }
        .footer { font-size: ${px(LAYOUT.footer.size)}px; font-weight: 600; }
      </style>
      ${rows}${note}${footerText}
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
  size: number = CREDIT_SIZE,
): Promise<Buffer | null> => {
  if (!credit.overlayKey) return null
  const overlayBytes = await storage.get(credit.overlayKey).catch(() => null)
  if (!overlayBytes) return null

  // The background is optional — a fully opaque overlay is a legitimate design — so a
  // missing one falls back to black rather than failing the render.
  const backgroundBytes = credit.backgroundKey
    ? await storage.get(credit.backgroundKey).catch(() => null)
    : null

  const base = backgroundBytes
    ? sharp(Buffer.from(backgroundBytes))
        // `cover` so a background of any aspect fills the square without letterboxing, which
        // on a card with a frame drawn over it would show as bars inside the frame.
        .resize(size, size, { fit: 'cover', position: 'centre' })
    : sharp({
        create: { width: size, height: size, channels: 3, background: '#0b0b0f' },
      })

  const overlay = await sharp(Buffer.from(overlayBytes))
    .resize(size, size, { fit: 'fill' })
    .png()
    .toBuffer()

  return base
    .composite([
      { input: overlay, top: 0, left: 0 },
      // Text last: it belongs on top of the frame, not under it.
      { input: textLayer(credit, size), top: 0, left: 0 },
    ])
    .jpeg({ quality: 90, progressive: true })
    .toBuffer()
}
