import { type WeekStart, weekStartIndex } from '@palscans/core/formatting'

/**
 * The calendar's date arithmetic, kept pure so both sides can use it: the server picks the
 * rows to fetch, the browser lays out the grid in the operator's own timezone.
 *
 * Everything here works in *local* time. A release calendar that buckets by UTC shows a
 * Monday 09:00 release on Sunday for half the world, which is exactly the mistake an
 * operator would not catch until a reader did.
 */

export type CalendarView = 'week' | 'month'

export const DAY_MS = 86_400_000

export const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

export const addDays = (date: Date, days: number): Date => {
  const out = new Date(date)
  out.setDate(out.getDate() + days)
  return out
}

/** ISO calendar date in local time: the key a day cell is addressed by. */
export const dayKey = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Monday-first by default, like every scanlation schedule anyone has ever drawn — and
 * Sunday-first when Appearance → Formatting → Week starts on says so (docs/15).
 */
export const startOfWeek = (date: Date, weekStartsOn: WeekStart = 'monday'): Date => {
  const start = startOfDay(date)
  const first = weekStartIndex(weekStartsOn)
  const offset = (start.getDay() - first + 7) % 7
  return addDays(start, -offset)
}

export const startOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1)

/** `?date=YYYY-MM-DD` → local midnight; anything unusable falls back to today. */
export const parseAnchor = (value: string | undefined, now = new Date()): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '')
  if (!match) return startOfDay(now)
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return Number.isNaN(date.getTime()) ? startOfDay(now) : date
}

export interface CalendarGrid {
  view: CalendarView
  anchor: Date
  /** Every day the grid draws, in order: 7 for a week, 35 or 42 for a month. */
  days: Date[]
  /** First rendered day, and the exclusive end — also the fetch window. */
  start: Date
  end: Date
}

/**
 * The days a view draws. A month view is whole weeks, so it always starts on the first day
 * of the week and spills into the neighbouring months — those cells are real days and can
 * be dropped on.
 */
export const buildGrid = (
  view: CalendarView,
  anchor: Date,
  weekStartsOn: WeekStart = 'monday',
): CalendarGrid => {
  const start =
    view === 'week'
      ? startOfWeek(anchor, weekStartsOn)
      : startOfWeek(startOfMonth(anchor), weekStartsOn)
  let length = 7
  if (view === 'month') {
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
    // Rounded, not floored: a DST week is 167 or 169 hours long, never exactly 7 × 24.
    const span = Math.round((monthEnd.getTime() - start.getTime()) / DAY_MS) + 1
    length = Math.ceil(span / 7) * 7
  }
  const days = Array.from({ length }, (_, i) => addDays(start, i))
  return { view, anchor, days, start, end: addDays(start, length) }
}

/** Previous / next period; `0` returns the anchor unchanged. */
export const shiftAnchor = (view: CalendarView, anchor: Date, delta: number): Date =>
  view === 'week'
    ? addDays(anchor, delta * 7)
    : new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)

/**
 * Move a chapter to another day while keeping the hour it was going out at — dragging a
 * Friday 18:00 release to Saturday should make it Saturday 18:00, not Saturday midnight.
 * A chapter with no date yet lands on `fallbackHour`.
 */
export const withTimeOf = (day: Date, source: Date | null, fallbackHour = 12): Date => {
  const out = startOfDay(day)
  if (source) out.setHours(source.getHours(), source.getMinutes(), 0, 0)
  else out.setHours(fallbackHour, 0, 0, 0)
  return out
}

/** `<input type="datetime-local">` wants local wall-clock text, never an ISO instant. */
export const toLocalInput = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const fromLocalInput = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const [, y, mo, d, h, mi] = match
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

/** The heading over the grid: "6 – 12 Oct 2026" or "October 2026". */
export const rangeLabel = (grid: CalendarGrid, locale?: string): string => {
  if (grid.view === 'month')
    return grid.anchor.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const last = grid.days[grid.days.length - 1] ?? grid.start
  const sameMonth = grid.start.getMonth() === last.getMonth()
  const from = grid.start.toLocaleDateString(locale, {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' }),
  })
  const to = last.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${from} – ${to}`
}
