/**
 * The arithmetic behind the analytics chart, kept out of the component so it can be
 * asserted directly (app/admin/analytics/analytics.test.ts). Nothing here touches the DOM
 * or React, and nothing here formats a date through `toLocaleString` — the server and the
 * viewer's browser would disagree and hydration would fail.
 */

export interface ChartPoint {
  /** `YYYY-MM-DD`, UTC — the bucket the rollup wrote. */
  bucket: string
  views: number
}

/** 1 / 2 / 2.5 / 5 × 10ⁿ — the step sizes an axis is allowed to use. */
const STEPS = [1, 2, 2.5, 5, 10]

const niceStep = (raw: number): number => {
  const exponent = Math.floor(Math.log10(raw))
  const base = 10 ** exponent
  const f = raw / base
  // Never below 1: views are whole things, and "0.25 views" on a gridline is nonsense.
  return Math.max(1, (STEPS.find((s) => f <= s + 1e-9) ?? 10) * base)
}

export interface AxisScale {
  /** The value the top gridline sits at. Always ≥ the largest data point. */
  max: number
  /** Every gridline value, `0` first. */
  ticks: number[]
}

/**
 * A y axis with round numbers on it. Four or five intervals, whichever wastes less room
 * above the data: 120k over four intervals would have to round up to 200k, but over five it
 * lands on 125k, and a chart whose data fills the plot is easier to read than one that
 * hugs the floor.
 */
export const axisScale = (dataMax: number, counts: readonly number[] = [4, 5]): AxisScale => {
  const target = Math.max(1, dataMax)
  let best: AxisScale | null = null
  for (const count of counts) {
    const step = niceStep(target / count)
    const max = step * count
    if (!best || max < best.max)
      best = { max, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) }
  }
  // `counts` is never empty in practice; the fallback keeps the return type honest.
  return best ?? { max: target, ticks: [0, target] }
}

/**
 * Which points get an x-axis label. Counted back from the last point, so "today" is always
 * labelled and the gaps are even — labelling from the left instead leaves a ragged stub at
 * the right edge, which is the end everyone reads first.
 */
export const labelIndexes = (count: number, maxLabels = 7): number[] => {
  if (count <= 0) return []
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i)
  const step = Math.ceil((count - 1) / (maxLabels - 1))
  const out: number[] = []
  for (let i = count - 1; i >= 0; i -= step) out.unshift(i)
  return out
}

/** `1234567` → `1,234,567`. Locale-free on purpose (see the note at the top). */
export const groupDigits = (n: number): string =>
  Math.trunc(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * `81300` → `81.3K`. The same rule as `compactNumber` in @palscans/core, restated here
 * because this module is imported by a client component and the core package's entry point
 * pulls in the queue (ioredis, bullmq), which cannot be bundled for a browser.
 */
export const compactCount = (n: number): string => {
  if (n < 1000) return String(Math.round(n * 10) / 10)
  if (n < 1_000_000) return `${trimZero((n / 1000).toFixed(1))}K`
  if (n < 1_000_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`
  return `${trimZero((n / 1_000_000_000).toFixed(1))}B`
}

const trimZero = (s: string): string => s.replace(/\.0$/, '')

/** `2026-09-04` → `09-04`, the x-axis tick. The tooltip and the table show the full date. */
export const monthDay = (bucket: string): string => bucket.slice(5)

export interface WindowSummary {
  total: number
  /** Mean views per day across the whole window, quiet days included. */
  average: number
  peak: ChartPoint | null
}

/** The three numbers that ride along with the chart's title. */
export const summarise = (points: readonly ChartPoint[]): WindowSummary => {
  if (points.length === 0) return { total: 0, average: 0, peak: null }
  let total = 0
  let peak = points[0] as ChartPoint
  for (const p of points) {
    total += p.views
    if (p.views > peak.views) peak = p
  }
  return { total, average: Math.round(total / points.length), peak }
}

/**
 * The plot geometry: where each point lands, in SVG user units. `x` is spread across the
 * plot even when a single point is asked for (it then sits at the left edge rather than
 * dividing by zero).
 */
export interface PlotBox {
  width: number
  height: number
  padding: { top: number; right: number; bottom: number; left: number }
}

export const plotPoints = (
  points: readonly ChartPoint[],
  max: number,
  box: PlotBox,
): Array<{ x: number; y: number; point: ChartPoint }> => {
  const { padding } = box
  const w = Math.max(1, box.width - padding.left - padding.right)
  const h = Math.max(1, box.height - padding.top - padding.bottom)
  const step = points.length > 1 ? w / (points.length - 1) : 0
  return points.map((point, i) => ({
    x: padding.left + i * step,
    y: padding.top + h - (max > 0 ? (point.views / max) * h : 0),
    point,
  }))
}

/** The nearest point to an x offset in the same user units `plotPoints` returns. */
export const nearestIndex = (xs: readonly number[], x: number): number => {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs((xs[i] as number) - x)
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best
}
