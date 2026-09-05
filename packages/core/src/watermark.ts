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

// ---------------------------------------------------------------------------
// Re-applying the mark to what is already processed
// ---------------------------------------------------------------------------

/**
 * `settings.watermark_reapply` — the one live (or last finished) re-apply run.
 *
 * A settings row rather than a table: there is at most one run at a time, the operator only
 * ever needs the current one, and who started it is already in the audit log. The row *is*
 * the checkpoint — see {@link WatermarkRun.cursor}.
 */
export const WATERMARK_REAPPLY_KEY = 'watermark_reapply'

export const WATERMARK_RUN_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export type WatermarkRunStatus = (typeof WATERMARK_RUN_STATUSES)[number]

/**
 * Why one chapter came out of a run untouched.
 *
 * `missing_originals` is the one that decides whether this feature is possible at all for a
 * given chapter: the mark is composited from the *uploaded original*, never from a page the
 * pipeline already wrote, so a chapter whose originals have gone cannot be re-marked by
 * anything short of re-uploading it. It is reported per chapter rather than skipped
 * silently, because "nothing happened" and "this can never happen" are different answers.
 */
export const WATERMARK_SKIP_REASONS = [
  'no_sources',
  'missing_originals',
  'foreign_sources',
  'processing',
  'failed',
] as const
export type WatermarkSkipReason = (typeof WATERMARK_SKIP_REASONS)[number]

export interface WatermarkRunProblem {
  chapterId: number
  seriesId?: number
  /** Chapter number, so the panel has a label the operator recognises without another query. */
  number?: number
  reason: WatermarkSkipReason
  detail?: string
}

export interface WatermarkRunTotals {
  /** Candidates when the run started. An estimate: chapters can be added while it walks. */
  chapters: number
  /** Chapters the run has finished with, whatever the outcome. */
  done: number
  /** Chapters whose pages were rebuilt and re-pointed. */
  rewritten: number
  /** Chapters that already carried this exact mark — proved, not assumed, and left alone. */
  alreadyCurrent: number
  /** Chapters reported in `problems`. */
  skipped: number
  pages: number
  /** Bytes of page variants that stopped being referenced. Not deleted — see docs/03. */
  orphanBytes: number
}

/**
 * One re-apply run (docs/03 "Re-applying the mark").
 *
 * Resumable: `cursor` is the highest chapter id fully finished, committed with the counters
 * after every chapter, so a worker that dies mid-run restarts on the next chapter instead of
 * re-encoding the catalogue from the top. Cancellable: `cancelRequested` is read between
 * chapters, which is why stopping one never leaves a half-written chapter behind.
 */
export interface WatermarkRun {
  id: string
  status: WatermarkRunStatus
  /**
   * The mark this run applies, as {@link watermarkFingerprint} — `''` for "no mark".
   *
   * Pinned at start. If the operator saves different settings while it runs, the run stops
   * with `settings_changed` rather than half-applying two different marks across the
   * catalogue.
   */
  fingerprint: string
  /** The mark's text as the panel should name it; empty when the run is removing the mark. */
  label: string
  /** Chapter ids in scope, or `null` for the whole catalogue. */
  scope: number[] | null
  /** Highest chapter id fully finished. The resume point. */
  cursor: number
  totals: WatermarkRunTotals
  problems: WatermarkRunProblem[]
  cancelRequested: boolean
  startedBy: number | null
  startedAt: string
  updatedAt: string
  /** Bumped every chapter; a run whose heartbeat has gone cold is picked back up. */
  heartbeatAt: string | null
  finishedAt: string | null
  /** Set when `status` is `failed`: `no_font`, `settings_changed`, or an error message. */
  error: string | null
}

/** Cap on the problem list so one bad batch cannot grow the settings row without bound. */
export const WATERMARK_RUN_PROBLEM_LIMIT = 200

/**
 * A stored run row turned into a usable one. Never throws, for the same reason
 * {@link normalizeWatermark} does not: a row written by an older build must not stop the
 * worker, and the panel must always have something to render.
 */
export const normalizeWatermarkRun = (raw: unknown): WatermarkRun | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return null
  const status = WATERMARK_RUN_STATUSES.includes(o.status as WatermarkRunStatus)
    ? (o.status as WatermarkRunStatus)
    : 'failed'
  const t = (o.totals ?? {}) as Record<string, unknown>
  const int = (v: unknown): number => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  }
  const iso = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  const problems = Array.isArray(o.problems)
    ? o.problems
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({
          chapterId: int(p.chapterId),
          seriesId: p.seriesId === undefined ? undefined : int(p.seriesId),
          number: p.number === undefined ? undefined : Number(p.number),
          reason: (WATERMARK_SKIP_REASONS.includes(p.reason as WatermarkSkipReason)
            ? p.reason
            : 'failed') as WatermarkSkipReason,
          detail: typeof p.detail === 'string' ? p.detail.slice(0, 300) : undefined,
        }))
        .slice(0, WATERMARK_RUN_PROBLEM_LIMIT)
    : []
  return {
    id: o.id,
    status,
    fingerprint: typeof o.fingerprint === 'string' ? o.fingerprint : '',
    label: typeof o.label === 'string' ? o.label : '',
    scope: Array.isArray(o.scope) ? o.scope.map((n) => int(n)).filter((n) => n > 0) : null,
    cursor: int(o.cursor),
    totals: {
      chapters: int(t.chapters),
      done: int(t.done),
      rewritten: int(t.rewritten),
      alreadyCurrent: int(t.alreadyCurrent),
      skipped: int(t.skipped),
      pages: int(t.pages),
      orphanBytes: int(t.orphanBytes),
    },
    problems,
    cancelRequested: o.cancelRequested === true,
    startedBy: typeof o.startedBy === 'number' ? o.startedBy : null,
    startedAt: iso(o.startedAt) ?? new Date(0).toISOString(),
    updatedAt: iso(o.updatedAt) ?? iso(o.startedAt) ?? new Date(0).toISOString(),
    heartbeatAt: iso(o.heartbeatAt),
    finishedAt: iso(o.finishedAt),
    error: typeof o.error === 'string' ? o.error : null,
  }
}

export const watermarkRunLive = (run: WatermarkRun | null): boolean =>
  !!run && (run.status === 'queued' || run.status === 'running')

/**
 * What one chapter's stored pages carry, relative to the mark configured now.
 *
 * - `current` — the pipeline recorded this exact fingerprint for its pages.
 * - `stale` — it recorded a different one (an older mark, or none).
 * - `unknown` — processed before the fingerprint was recorded. Deliberately *not* folded
 *   into `stale`: we genuinely do not know, and the only honest way to find out is to
 *   re-derive the address from the original, which is what a run does.
 * - `unmarkable` — there are pages but no usable originals, so no run can ever fix it.
 * - `unprocessed` — no pages yet; the next processing run applies the current mark anyway.
 */
export const WATERMARK_PAGE_STATES = [
  'current',
  'stale',
  'unknown',
  'unmarkable',
  'unprocessed',
] as const
export type WatermarkPageState = (typeof WATERMARK_PAGE_STATES)[number]

/**
 * How a catalogue stands against the mark configured now. The buckets partition the
 * processed chapters exactly, in {@link watermarkPageState}'s priority order, so the panel's
 * numbers always add up and nobody has to wonder where the missing chapters went.
 */
export interface WatermarkCounts {
  /** Chapters with pages at all — the denominator. */
  processed: number
  current: number
  stale: number
  unknown: number
  unmarkable: number
  /** `stale + unknown`: what a re-apply run would work on. */
  affected: number
}

export interface WatermarkStateInput {
  pageCount: number
  /** `chapters.processing.watermark`, absent for anything processed before it was recorded. */
  recorded?: string | null
  /** Whether `chapters.processing.sources` still names originals to composite from. */
  hasSources: boolean
}

export const watermarkPageState = (
  input: WatermarkStateInput,
  current: string,
): WatermarkPageState => {
  if (input.pageCount <= 0) return 'unprocessed'
  if (!input.hasSources) return 'unmarkable'
  if (input.recorded === undefined || input.recorded === null) return 'unknown'
  return input.recorded === current ? 'current' : 'stale'
}
