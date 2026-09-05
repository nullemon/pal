/**
 * Social share cards (docs/12 §2 "og:image at 1200×630"): the geometry, the text fitting and
 * the URL/cache keys for `/api/og/*`. Everything here is pure so the awkward cases — a
 * 60-character title, a series with no cover, chapter `12.5` — are unit-testable without
 * rasterising anything. The drawing itself lives in `og-render.tsx`.
 */

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

/** Card geometry, in card pixels. */
export const OG_LAYOUT = {
  pad: 56,
  coverWidth: 336,
  /** 2:3, the intrinsic ratio of every cover the worker produces (docs/05). */
  coverHeight: 504,
  gutter: 48,
} as const

/** Width available to the text column once the cover and the padding are taken out. */
export const OG_TEXT_WIDTH = OG_WIDTH - OG_LAYOUT.pad * 2 - OG_LAYOUT.coverWidth - OG_LAYOUT.gutter

/**
 * Advance width per character as a fraction of the font size, for the card font (Geist,
 * the face `ImageResponse` ships with). Approximate on purpose: it decides where a line
 * wraps and which font size fits, and being a few percent wide only ever makes the card
 * more conservative. Calibrated against rendered cards, not against the font tables.
 */
const NARROW = new Set('iljtfrI.,:;!|\'’‘"[]()-· ')
const WIDE = new Set('mwMW@%')

export const charWidth = (ch: string): number => {
  if (ch === ' ') return 0.26
  if (NARROW.has(ch)) return 0.31
  if (WIDE.has(ch)) return 0.88
  if (ch >= '0' && ch <= '9') return 0.58
  if (ch >= 'A' && ch <= 'Z') return 0.67
  if (ch >= 'a' && ch <= 'z') return 0.55
  // CJK and everything else full-width enough that guessing narrow would overflow.
  return ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6
}

/** Rendered width of `text` at `fontSize`, plus the tracking applied per character. */
export const measureText = (text: string, fontSize: number, tracking = 0): number => {
  let em = 0
  for (const ch of text) em += charWidth(ch)
  return em * fontSize + tracking * Math.max(0, [...text].length - 1)
}

/** Cut `text` to `maxWidth`, appending an ellipsis; never returns an empty string. */
export const ellipsise = (text: string, fontSize: number, maxWidth: number): string => {
  if (measureText(text, fontSize) <= maxWidth) return text
  const chars = [...text]
  const ellipsis = measureText('…', fontSize)
  let width = 0
  const out: string[] = []
  for (const ch of chars) {
    const next = width + charWidth(ch) * fontSize
    if (next + ellipsis > maxWidth) break
    width = next
    out.push(ch)
  }
  // Do not leave a dangling space or hyphen in front of the ellipsis.
  while (out.length > 1 && /[\s\-–—·]$/.test(out[out.length - 1] ?? '')) out.pop()
  return `${out.join('') || chars[0] || ''}…`
}

/** Greedy word wrap. A single word longer than the line is broken mid-word rather than overflowing. */
export const wrapText = (text: string, fontSize: number, maxWidth: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (measureText(candidate, fontSize) <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    if (measureText(word, fontSize) <= maxWidth) {
      line = word
      continue
    }
    // One unbreakable word wider than the column: hard-break it.
    let piece = ''
    for (const ch of word) {
      if (measureText(piece + ch, fontSize) > maxWidth) {
        if (piece) lines.push(piece)
        piece = ch
      } else {
        piece += ch
      }
    }
    line = piece
  }
  if (line) lines.push(line)
  return lines
}

export interface FitOptions {
  maxWidth: number
  /** Sizes to try, largest first. */
  sizes: readonly number[]
  maxLines: number
  /**
   * Vertical room for the whole block. Without it a title can fit the column three lines
   * wide and still push the chapter badge into the footer — which is how the card breaks in
   * practice, since nothing about the wrapping looks wrong until it is rasterised.
   */
  maxHeight?: number
  lineHeight?: number
}

export interface FittedText {
  lines: string[]
  fontSize: number
  /** Height of one line box, which the card sets explicitly so layout matches this maths. */
  lineBox: number
  /** True when the text had to be cut to fit — the card still renders, the title is clipped. */
  truncated: boolean
}

/** How many lines of `fontSize` fit in `maxHeight`; unbounded when no height is given. */
const lineBudget = (opts: FitOptions, fontSize: number): number => {
  if (!opts.maxHeight) return opts.maxLines
  const box = Math.round(fontSize * (opts.lineHeight ?? 1.3))
  return Math.min(opts.maxLines, Math.max(1, Math.floor(opts.maxHeight / box)))
}

/**
 * Pick the largest size at which `text` fits the column and the height budget, and return
 * the lines to draw. The card draws the lines itself rather than letting the rasteriser
 * wrap: the wrapping is then the same thing the tests assert, and a title that cannot fit is
 * ellipsised instead of silently spilling over the badge below it.
 */
export const fitText = (text: string, opts: FitOptions): FittedText => {
  const lineHeight = opts.lineHeight ?? 1.3
  const floor = opts.sizes[opts.sizes.length - 1] ?? 40
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) {
    return { lines: [], fontSize: floor, lineBox: Math.round(floor * lineHeight), truncated: false }
  }
  for (const fontSize of opts.sizes) {
    const lines = wrapText(clean, fontSize, opts.maxWidth)
    if (lines.length <= lineBudget(opts, fontSize)) {
      return { lines, fontSize, lineBox: Math.round(fontSize * lineHeight), truncated: false }
    }
  }
  const lines = wrapText(clean, floor, opts.maxWidth).slice(0, lineBudget(opts, floor))
  const last = lines[lines.length - 1]
  if (last !== undefined) lines[lines.length - 1] = ellipsise(`${last}…`, floor, opts.maxWidth)
  return { lines, fontSize: floor, lineBox: Math.round(floor * lineHeight), truncated: true }
}

/** Title sizes, largest first. The floor still reads at Telegram's ~320px preview width. */
export const TITLE_SIZES = [76, 68, 60, 54, 48, 44] as const
export const TITLE_MAX_LINES = 3
export const TITLE_LINE_HEIGHT = 1.3

/**
 * Vertical room for the title, measured off the card: the text column is as tall as the
 * cover, minus the eyebrow, the footer (rating line + wordmark) and — on a chapter card —
 * the chapter badge.
 */
export const EYEBROW_BLOCK = 46
export const FOOTER_BLOCK = 96
export const CHAPTER_BLOCK = 100
export const CARD_SLACK = 18

export const titleHeightBudget = (hasChapter: boolean): number =>
  OG_LAYOUT.coverHeight -
  EYEBROW_BLOCK -
  FOOTER_BLOCK -
  (hasChapter ? CHAPTER_BLOCK : 0) -
  CARD_SLACK

export const fitTitle = (
  title: string,
  opts: { hasChapter?: boolean; maxWidth?: number } = {},
): FittedText =>
  fitText(title, {
    maxWidth: opts.maxWidth ?? OG_TEXT_WIDTH,
    sizes: TITLE_SIZES,
    maxLines: TITLE_MAX_LINES,
    maxHeight: titleHeightBudget(opts.hasChapter ?? false),
    lineHeight: TITLE_LINE_HEIGHT,
  })

/**
 * Up to two initials for the placeholder panel drawn when a series has no cover. Words that
 * are pure punctuation or numerals are skipped so "12 Ways" does not become "1W", and short
 * lowercase connectors are skipped too — manga titles are full of them, and "Return of the
 * Frost Monarch" reading as "RO" looks like a mistake where "RF" looks like a monogram.
 */
export const coverInitials = (title: string): string => {
  const words = title
    .split(/[\s\-–—:·]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
  const letters = words.filter((w) => /^\p{L}/u.test(w))
  const source = letters.length > 0 ? letters : words
  const meaningful = source.filter((w) => w.length > 3 || w !== w.toLowerCase())
  const picked = meaningful.length >= 2 ? meaningful : source
  const initials = picked.slice(0, 2).map((w) => [...w][0] ?? '')
  return initials.join('').toUpperCase() || '?'
}

/** A hex colour from the database, or null when it is missing or malformed. */
export const normaliseTint = (color: string | null | undefined): string | null => {
  if (!color) return null
  const hex = color.trim()
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex.toLowerCase() : null
}

export interface OgCardText {
  /** "MANHWA · ONGOING", above the title. */
  eyebrow: string
  title: string
  /** "Chapter 12.5" — the accent line. Absent on a series card. */
  chapter: string | null
  /** "301 chapters", or null for a series with none yet. */
  chapters: string | null
  /**
   * "9.6", drawn beside a star, or null when nobody has rated the series. The star is drawn
   * as a shape, not typed: the card font (Geist) has no U+2605 and satori renders a missing
   * glyph as a tofu box — which is exactly the kind of thing that only shows up in the image.
   */
  rating: string | null
}

/**
 * The fingerprint an OG URL carries as `?v=`. Every input that changes a pixel is in it, so
 * the URL changes when the card does and the response can be cached hard and long. Chosen
 * over a timestamp so two deploys of the same data reuse the CDN's copy.
 */
export const cardFingerprint = (
  parts: ReadonlyArray<string | number | null | undefined>,
): string => {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const input = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join(' ')
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 12)
}

export const seriesOgPath = (slug: string, version: string): string =>
  `/api/og/series/${encodeURIComponent(slug)}?v=${version}`

export const chapterOgPath = (slug: string, chapter: string, version: string): string =>
  `/api/og/chapter/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}?v=${version}`
