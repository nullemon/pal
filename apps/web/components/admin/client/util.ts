/**
 * Client-safe copies of the tiny formatting helpers from @palscans/core (`time.ts`,
 * `slug.ts`). The core root barrel re-exports the queue adapter, which drags BullMQ into
 * any client bundle that imports it (apps/web/README.md), so admin islands use these.
 */
export const formatChapterNumber = (n: number | string): string => {
  const value = typeof n === 'string' ? Number.parseFloat(n) : n
  if (!Number.isFinite(value)) return String(n)
  return String(Number.parseFloat(value.toFixed(3)))
}

const MINUTE = 60
const HOUR = 3600
const DAY = 86400

/** "2d 4h", "4h 12m", "35m". */
export const countdown = (until: Date | string | number, now: Date = new Date()): string => {
  const then = until instanceof Date ? until : new Date(until)
  const diff = Math.max(0, Math.round((then.getTime() - now.getTime()) / 1000))
  const d = Math.floor(diff / DAY)
  const h = Math.floor((diff % DAY) / HOUR)
  const m = Math.floor((diff % HOUR) / MINUTE)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${Math.max(1, m)}m`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many} ago`

/** "12 min ago", "3 days ago", "in 2d 4h" — same copy as core's relativeTime. */
export const relativeTime = (date: Date | string | number, now: Date = new Date()): string => {
  const then = date instanceof Date ? date : new Date(date)
  const diff = Math.round((now.getTime() - then.getTime()) / 1000)
  if (diff < 0) return `in ${countdown(then, now)}`
  if (diff < 45) return 'just now'
  if (diff < HOUR) return plural(Math.max(1, Math.round(diff / MINUTE)), 'min', 'min')
  if (diff < DAY) return plural(Math.round(diff / HOUR), 'hour', 'hours')
  if (diff < 7 * DAY) return plural(Math.round(diff / DAY), 'day', 'days')
  if (diff < 14 * DAY) return 'last week'
  if (diff < 30 * DAY) return plural(Math.round(diff / (7 * DAY)), 'week', 'weeks')
  if (diff < 365 * DAY) return plural(Math.max(1, Math.round(diff / (30 * DAY))), 'month', 'months')
  return plural(Math.max(1, Math.round(diff / (365 * DAY))), 'year', 'years')
}

/** Lowercase hyphenated ASCII, like core's slugify (the server re-derives and validates). */
export const slugify = (input: string): string =>
  input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[''`]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '')
