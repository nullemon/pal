import { z } from 'zod'

/**
 * The site watermark burned into every page variant by `chapter.process` (docs/03 "Worker:
 * chapter.process", step 5–7).
 *
 * It is composited into the pixels, not overlaid in CSS: the whole point is that the
 * attribution survives a right-click-save, a screenshot or a repost on another site, which
 * is how a scanlation site gets found. A CSS overlay disappears at exactly the moment it
 * would have done its job.
 *
 * This module is deliberately dependency-free (zod only) and exported from
 * `@palscans/core/watermark` so the admin screen can import the schema without pulling the
 * package root — and therefore `env`, `storage` and the queue — into a client bundle. The
 * worker composites the SVG this module builds; nothing here touches sharp.
 */

export const WATERMARK_SETTING_KEY = 'watermark'

export const WATERMARK_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export type WatermarkCorner = (typeof WATERMARK_CORNERS)[number]

/** Bounds the admin panel enforces and the geometry clamps to regardless. */
export const WATERMARK_LIMITS = {
  /** Percent of the image width used as the font size. */
  scale: { min: 1, max: 8, step: 0.1 },
  /** Percent of the image width used as the inset from both edges. */
  margin: { min: 0.5, max: 8, step: 0.1 },
  /** 0–1; the whole mark, outline included, is drawn at this alpha. */
  opacity: { min: 0.05, max: 1, step: 0.01 },
  textMaxLength: 64,
} as const

/** Never render text smaller than this: a 480 px variant must still be readable. */
export const WATERMARK_MIN_FONT_PX = 11
/** Never let the mark grow past this share of the image width, whatever the scale says. */
export const WATERMARK_MAX_FONT_RATIO = 0.12

export interface WatermarkConfig {
  enabled: boolean
  text: string
  corner: WatermarkCorner
  /** Font size as a percent of the image width. */
  scale: number
  /** Inset from the two nearest edges, as a percent of the image width. */
  margin: number
  /** 0–1. */
  opacity: number
}

export const WATERMARK_DEFAULTS: WatermarkConfig = {
  enabled: true,
  text: 'palscans.org',
  corner: 'top-right',
  scale: 2.4,
  margin: 2,
  opacity: 0.34,
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

/** Collapse whitespace, drop control characters, cap the length. */
export const cleanWatermarkText = (raw: string): string =>
  raw
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WATERMARK_LIMITS.textMaxLength)

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export const watermarkSettingSchema = z.object({
  enabled: z.boolean(),
  text: z
    .string()
    .transform(cleanWatermarkText)
    .refine((v) => v.length > 0, { message: 'Watermark text cannot be empty' }),
  corner: z.enum(WATERMARK_CORNERS),
  scale: z.coerce
    .number()
    .min(WATERMARK_LIMITS.scale.min)
    .max(WATERMARK_LIMITS.scale.max)
    .transform(round1),
  margin: z.coerce
    .number()
    .min(WATERMARK_LIMITS.margin.min)
    .max(WATERMARK_LIMITS.margin.max)
    .transform(round1),
  opacity: z.coerce
    .number()
    .min(WATERMARK_LIMITS.opacity.min)
    .max(WATERMARK_LIMITS.opacity.max)
    .transform(round2),
})

/**
 * A stored `settings.watermark` row (or anything else) turned into a usable config. Never
 * throws: a row written by an older build, or hand-edited SQL, must not stop the pipeline —
 * a bad field falls back to the default rather than failing the chapter.
 */
export const normalizeWatermark = (raw: unknown): WatermarkConfig => {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const text = cleanWatermarkText(typeof o.text === 'string' ? o.text : WATERMARK_DEFAULTS.text)
  const num = (value: unknown, fallback: number, min: number, max: number, r: typeof round1) => {
    if (value === undefined || value === null || value === '') return fallback
    const n = Number(value)
    return Number.isFinite(n) ? r(clamp(n, min, max)) : fallback
  }
  const corner = WATERMARK_CORNERS.includes(o.corner as WatermarkCorner)
    ? (o.corner as WatermarkCorner)
    : WATERMARK_DEFAULTS.corner
  return {
    enabled:
      (typeof o.enabled === 'boolean' ? o.enabled : WATERMARK_DEFAULTS.enabled) && text.length > 0,
    text: text || WATERMARK_DEFAULTS.text,
    corner,
    scale: num(
      o.scale,
      WATERMARK_DEFAULTS.scale,
      WATERMARK_LIMITS.scale.min,
      WATERMARK_LIMITS.scale.max,
      round1,
    ),
    margin: num(
      o.margin,
      WATERMARK_DEFAULTS.margin,
      WATERMARK_LIMITS.margin.min,
      WATERMARK_LIMITS.margin.max,
      round1,
    ),
    opacity: num(
      o.opacity,
      WATERMARK_DEFAULTS.opacity,
      WATERMARK_LIMITS.opacity.min,
      WATERMARK_LIMITS.opacity.max,
      round2,
    ),
  }
}

/**
 * The canonical string folded into a page's content address (docs/03 "Storage layout").
 *
 * Object keys are content-addressed and served `immutable`, so two different watermarks must
 * never share a key. Changing the text, the corner, the size or the opacity changes this
 * string, therefore the hash, therefore the key — the old objects simply stop being
 * referenced, exactly as a re-uploaded page behaves. A disabled watermark contributes
 * nothing, so turning it off restores the original keys.
 */
export const watermarkFingerprint = (config: WatermarkConfig): string =>
  config.enabled
    ? `wm1|${config.text}|${config.corner}|${config.scale}|${config.margin}|${config.opacity}`
    : ''

export interface WatermarkGeometry {
  /** Overlay width — always the full width of the image it is composited onto. */
  width: number
  /** Overlay height: a band along the top or bottom edge, never the whole page. */
  height: number
  fontSize: number
  margin: number
  /** Text anchor position inside the band. */
  x: number
  y: number
  anchor: 'start' | 'end'
  /** Where sharp pins the band on the page. */
  gravity: 'north' | 'south'
  strokeWidth: number
  opacity: number
  text: string
}

/**
 * Where the mark sits on an image of this exact size, in that image's own pixels.
 *
 * Two properties matter and both are tested:
 *
 * - **It scales with the image.** Everything is a fraction of the *width*, so the 480 px and
 *   the 1440 px variant of the same page carry a mark of the same relative size. The mark is
 *   built per output width rather than composited once and downscaled, so the text is crisp
 *   at every width instead of a blurred thumbnail of the largest one.
 * - **It is a band, not a full-page overlay.** The band is pinned with a gravity, so the
 *   caller never has to predict the exact height libvips produced for a resize — an
 *   off-by-one there would abort the composite.
 *
 * Returns `null` when the image is too small to carry the mark without covering the art.
 */
export const watermarkGeometry = (
  width: number,
  height: number,
  config: WatermarkConfig,
): WatermarkGeometry | null => {
  if (!config.enabled) return null
  const text = cleanWatermarkText(config.text)
  if (!text) return null
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  const w = Math.floor(width)
  const h = Math.floor(height)
  if (w < 64 || h < 32) return null

  const fontSize = Math.round(
    clamp((w * config.scale) / 100, WATERMARK_MIN_FONT_PX, w * WATERMARK_MAX_FONT_RATIO),
  )
  const margin = Math.max(Math.round((w * config.margin) / 100), Math.round(fontSize * 0.3))
  const band = margin + Math.ceil(fontSize * 1.45)
  // The band may never take more than a sixth of the page: on a short strip segment a
  // corner mark that tall stops being a corner mark.
  if (band >= h || band > h / 6) return null

  const top = config.corner === 'top-left' || config.corner === 'top-right'
  const left = config.corner === 'top-left' || config.corner === 'bottom-left'
  return {
    width: w,
    height: band,
    fontSize,
    margin,
    x: left ? margin : w - margin,
    y: top ? margin + Math.round(fontSize * 0.72) : band - margin - Math.round(fontSize * 0.21),
    anchor: left ? 'start' : 'end',
    gravity: top ? 'north' : 'south',
    strokeWidth: Math.max(2, Math.round(fontSize * 0.18)),
    opacity: config.opacity,
    text,
  }
}

const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/**
 * A widely available grotesque first, then the generic. librsvg resolves this through
 * fontconfig, so the worker image has to carry at least one real sans face — see
 * `infra/Dockerfile`. `watermarkOverlay()` in the worker probes for that and skips the
 * composite rather than burning an invisible mark into every page.
 */
export const WATERMARK_FONT_STACK =
  "'DejaVu Sans','Liberation Sans','Helvetica Neue',Helvetica,Arial,sans-serif"

/**
 * The overlay, as an SVG string sized in the target image's pixels.
 *
 * The mark is drawn twice: a dark, rounded stroke underneath and a white fill on top. That
 * is what keeps one setting legible over both a black gutter and a white speech bubble —
 * over dark art the white body reads, over light art the dark halo does. Everything sits in
 * one group so the operator's opacity dims halo and body together and the mark never turns
 * into a hard-edged sticker.
 */
export const watermarkSvg = (g: WatermarkGeometry): string => {
  const text = xmlEscape(g.text)
  const common = `x="${g.x}" y="${g.y}" text-anchor="${g.anchor}"`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}"><g font-family="${WATERMARK_FONT_STACK}" font-size="${g.fontSize}" font-weight="700" letter-spacing="${round2(g.fontSize * 0.01)}" opacity="${g.opacity}"><text ${common} fill="#000000" fill-opacity="0.85" stroke="#000000" stroke-opacity="0.85" stroke-width="${g.strokeWidth}" stroke-linejoin="round">${text}</text><text ${common} fill="#ffffff">${text}</text></g></svg>`
}
