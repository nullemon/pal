/**
 * The arithmetic behind `/admin/moderation`, kept out of the components so it can be
 * asserted directly (./moderation.test.ts). Nothing here touches the DOM, and nothing here
 * formats through `toLocale*` — the server and the viewer's browser would disagree and
 * hydration would fail (the same rule the analytics chart follows).
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * An elapsed span, at the precision a queue is judged at: days once it has been days, hours
 * inside a day, minutes inside an hour. `countdown()` in @palscans/core is the same shape
 * for the future; this is the past, and it never rounds an overdue item down to "0m".
 */
export const duration = (ms: number): string => {
  const t = Math.max(0, Math.round(ms))
  if (t < MINUTE) return 'under a minute'
  const d = Math.floor(t / DAY)
  const h = Math.floor((t % DAY) / HOUR)
  const m = Math.floor((t % HOUR) / MINUTE)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

/** The same span in one unit, for a hero figure that has to read at 48px. */
export const durationParts = (ms: number): { value: string; unit: string } => {
  const t = Math.max(0, Math.round(ms))
  if (t >= DAY) {
    const d = Math.floor(t / DAY)
    return { value: String(d), unit: d === 1 ? 'day' : 'days' }
  }
  if (t >= HOUR) {
    const h = Math.floor(t / HOUR)
    return { value: String(h), unit: h === 1 ? 'hour' : 'hours' }
  }
  const m = Math.max(1, Math.floor(t / MINUTE))
  return { value: String(m), unit: m === 1 ? 'minute' : 'minutes' }
}

export type Severity = 'ok' | 'warn' | 'danger'

/**
 * How loud the screen should be about an age. The thresholds are the queue's own SLA and a
 * week; the point of returning a severity rather than a boolean is that "fine", "late" and
 * "explain yourself" get three different treatments instead of one red flag for everything.
 */
export const severityFor = (ms: number, slaHours: number): Severity => {
  if (ms > 7 * DAY) return 'danger'
  if (ms > slaHours * HOUR) return 'warn'
  return 'ok'
}

export interface StackSegment<T> {
  item: T
  /** Percentage of the bar, already accounting for the 2px surface gaps between segments. */
  percent: number
}

/**
 * Widths for a horizontal stacked bar. Zero-count segments are dropped rather than rendered
 * as a hairline — a 0.4% sliver is not a value anyone can read, and the table under the bar
 * carries every number anyway.
 */
export const stack = <T>(items: readonly T[], countOf: (item: T) => number): StackSegment<T>[] => {
  const kept = items.filter((i) => countOf(i) > 0)
  const total = kept.reduce((t, i) => t + countOf(i), 0)
  if (total === 0) return []
  return kept.map((item) => ({ item, percent: (countOf(item) / total) * 100 }))
}

/**
 * The three-step ordinal ramp the age bands are drawn in: one hue (the `danger` token),
 * mixed towards the panel surface so the light end is dim on a dark theme and pale on a
 * light one. Validated in both modes against the dataviz ordinal checks — monotone
 * lightness, a visible step between neighbours, and the light end still clearing 2:1 on the
 * surface it sits on. Expressed as `color-mix` rather than fixed hexes so an operator's own
 * palette (Appearance → Theme rewrites `--color-danger`) carries through unchanged.
 */
export const AGE_RAMP = [60, 80, 100] as const

export const ageFill = (step: number): string =>
  `color-mix(in oklab, var(--color-danger) ${AGE_RAMP[step] ?? 100}%, var(--color-surface-1))`

/** A sparkline path over `values`, in the given box. Flat when every value is the same. */
export const sparkPath = (values: readonly number[], width: number, height: number): string => {
  if (values.length === 0) return ''
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? width / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = i * step
      const y = height - (v / max) * (height - 2) - 1
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
