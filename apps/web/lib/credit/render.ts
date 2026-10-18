import 'server-only'
import type { ResolvedCredit } from '@palscans/core/credit'
import type { Storage } from '@palscans/core/storage'
import sharp from 'sharp'
import {
  CREDIT_BACKDROP,
  CREDIT_HEIGHT,
  CREDIT_WIDTH,
  creditPlates,
  creditWindow,
  fitSize,
  fontMetrics,
  LAYOUT,
  wrapNote,
} from './layout'

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
 *
 * The measurements live in `./layout`, which has no dependencies and is tested.
 */

/**
 * The boxes are cream, so the text in them is near-black.
 *
 * White text was the first guess and it would have been invisible: every field this renderer
 * fills sits inside a pale panel. Not pure black — the artwork is ink-on-paper and a true
 * #000 reads as a sticker on top of it.
 */
const INK = '#16161a'

/** The plates the labels sit on are near-black, so their text is the paper colour. */
const PLATE_INK = '#f2ede1'

/** XML-escape. The values are operator-entered and go into an SVG document. */
const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const textLayer = (credit: ResolvedCredit, width: number, height: number): Buffer => {
  const w = (f: number) => Math.round(f * width)
  const h = (f: number) => Math.round(f * height)
  const font = fontMetrics(credit.font)
  const px = (f: number) => Math.max(1, Math.round(h(f) * font.scale))

  /**
   * Handles only — the role names are printed on the overlay.
   *
   * Taken in order and capped at the number of boxes the artwork has. A seventh role would
   * otherwise be drawn below the last box, over the NOTES header.
   */
  const handleBox = w(LAYOUT.rows.right - LAYOUT.rows.x)
  const labelBox = w(LAYOUT.plates.text.right - LAYOUT.plates.text.x)
  /**
   * One size for every label, not one per row.
   *
   * Sized to the longest, so `QUALITY CHECK` does not sit visibly smaller than `CLEANER`
   * two rows above it. A column of labels that each shrank to their own width reads as a
   * mistake; a column set a point smaller because one of them is long reads as a decision.
   */
  const labelSize = credit.roles
    .slice(0, LAYOUT.rows.max)
    .reduce(
      (size, role) => Math.min(size, fitSize(role.label, labelBox, size, font.em)),
      px(LAYOUT.plates.text.size),
    )
  const rows = credit.roles
    .slice(0, LAYOUT.rows.max)
    .map((role, i) => {
      const y = h(LAYOUT.rows.firstY) + i * h(LAYOUT.rows.stepY)
      // The label too, not just the handle: the printed one has been painted over, so if
      // this does not draw the row is a blank plate.
      const label = `<text x="${w(LAYOUT.plates.text.x)}" y="${y}" class="label">${esc(role.label)}</text>`
      const handle =
        role.handle.trim() === ''
          ? ''
          : `<text x="${w(LAYOUT.rows.x)}" y="${y}" class="handle" font-size="${fitSize(role.handle, handleBox, px(LAYOUT.rows.size), font.em)}">${esc(role.handle)}</text>`
      return label + handle
    })
    .join('')

  const noteSize = px(LAYOUT.note.size)
  const noteWidth = w(LAYOUT.note.right - LAYOUT.note.left)
  const noteChars = Math.max(12, Math.floor(noteWidth / (noteSize * font.em)))
  const note = wrapNote(credit.note, noteChars, LAYOUT.note.maxLines)
    .map(
      (line, i) =>
        `<text x="${w(LAYOUT.note.left)}" y="${h(LAYOUT.note.top) + i * Math.round(noteSize * LAYOUT.note.lineHeight)}" class="note">${esc(line)}</text>`,
    )
    .join('')

  const linkBox = w(LAYOUT.links.right - LAYOUT.links.x)
  const linkSize = px(LAYOUT.links.size)
  const link = (value: string, y: number) =>
    value.trim() === ''
      ? ''
      : `<text x="${w(LAYOUT.links.x)}" y="${h(y)}" class="link" font-size="${fitSize(value, linkBox, linkSize, font.em)}">${esc(value)}</text>`

  // The text face is set bold and italic; the comic faces ship one cut each and are left
  // alone — see `synthesise` in ./layout.
  const handleWeight = font.synthesise ? 'font-weight: 700;' : ''
  const linkWeight = font.synthesise ? 'font-weight: 600;' : ''
  const noteStyle = font.synthesise ? 'font-style: italic;' : ''

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <style>
        text { font-family: '${font.family}', 'DejaVu Sans', sans-serif; fill: ${INK}; dominant-baseline: middle; }
        .handle { ${handleWeight} }
        .label { fill: ${PLATE_INK}; font-size: ${labelSize}px; ${handleWeight} }
        .note { font-size: ${noteSize}px; ${noteStyle} }
        .link { ${linkWeight} }
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
   * itself, and every coordinate in `./layout` is a fraction precisely so this can vary.
   */
  const overlayImage = sharp(Buffer.from(overlayBytes))
  const meta = await overlayImage.metadata().catch(() => null)
  const width = meta?.width && meta.width > 0 ? meta.width : CREDIT_WIDTH
  const height = meta?.height && meta.height > 0 ? meta.height : CREDIT_HEIGHT

  // The background is optional — a series may have none and the artwork stands on its own —
  // so a missing one falls back to the backdrop rather than failing the render.
  const backgroundBytes = credit.backgroundKey
    ? await storage.get(credit.backgroundKey).catch(() => null)
    : null

  /**
   * The background goes in the window, not across the card.
   *
   * The frame is transparent over roughly the left two thirds and opaque under its own
   * artwork, so a background scaled to the whole canvas shows the *middle* of the picture
   * through the hole — on a portrait cover, somebody's chin. Fitted to the window, the
   * picture lands where the hole is. `cover` within it, so any aspect fills the window
   * without bars inside the frame.
   */
  const windowRect = creditWindow(width, height)
  const background = backgroundBytes
    ? await sharp(Buffer.from(backgroundBytes))
        .resize(windowRect.width, windowRect.height, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer()
        .catch(() => null)
    : null

  const overlay = await overlayImage.resize(width, height, { fit: 'fill' }).png().toBuffer()

  /**
   * Paint out the role names printed on the artwork, so the drawn ones can take their place.
   *
   * Each plate is patched with a strip of itself — the clean margin to the left of where its
   * printed text starts, stretched across the text. The plates are textured and lit, so a
   * flat rectangle of their average colour reads as a sticker stuck on the card; their own
   * pixels, smeared sideways, read as more plate.
   *
   * Failing soft is deliberate. If a replacement overlay has no plates where these
   * coordinates say, the worst case is a patch in the wrong place, and the worst case of a
   * `sharp` error here would be no credit page at all — so a patch that cannot be built is
   * skipped and the card is composed without it.
   */
  // Every plate, not just the filled rows: a row with no handle is dropped before it gets
  // here, and leaving its plate unpatched would put the artwork's own printed label back on
  // a card that disagrees with it two rows above.
  const framed = await creditPlates(width, height)
    .reduce(
      async (previous, plate) => {
        const layers = await previous
        const strip = await sharp(overlay)
          .extract(plate.sample)
          .resize(plate.patch.width, plate.patch.height, { fit: 'fill' })
          .png()
          .toBuffer()
          .catch(() => null)
        return strip
          ? [...layers, { input: strip, top: plate.patch.top, left: plate.patch.left }]
          : layers
      },
      Promise.resolve([] as Array<{ input: Buffer; top: number; left: number }>),
    )
    .then((layers) =>
      layers.length === 0
        ? overlay
        : sharp(overlay)
            .composite(layers)
            .png()
            .toBuffer()
            .catch(() => overlay),
    )

  return sharp({ create: { width, height, channels: 3, background: CREDIT_BACKDROP } })
    .composite([
      ...(background ? [{ input: background, top: windowRect.top, left: windowRect.left }] : []),
      { input: framed, top: 0, left: 0 },
      // Text last: it belongs on top of the frame, not under it.
      { input: textLayer(credit, width, height), top: 0, left: 0 },
    ])
    .jpeg({ quality: 90, progressive: true })
    .toBuffer()
}
