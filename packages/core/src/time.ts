const MINUTE = 60
const HOUR = 3600
const DAY = 86400
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

export type ChapterLabelStyle = 'short' | 'long' | 'hash'

/**
 * "12 min ago", "1 hour ago", "3 days ago", "last week", "2 weeks ago" …
 * Matches the copy in design/mockups/BRIEF.md. Future dates read "in 2d 4h".
 */
export const relativeTime = (date: Date | string | number, now: Date = new Date()): string => {
  const then = toDate(date)
  const diff = Math.round((now.getTime() - then.getTime()) / 1000)
  if (diff < 0) return `in ${countdown(then, now)}`
  if (diff < 45) return 'just now'
  if (diff < HOUR) return plural(Math.max(1, Math.round(diff / MINUTE)), 'min', 'min')
  if (diff < DAY) return plural(Math.round(diff / HOUR), 'hour', 'hours')
  if (diff < WEEK) return plural(Math.round(diff / DAY), 'day', 'days')
  if (diff < 2 * WEEK) return 'last week'
  if (diff < MONTH) return plural(Math.round(diff / WEEK), 'week', 'weeks')
  if (diff < YEAR) return plural(Math.max(1, Math.round(diff / MONTH)), 'month', 'months')
  return plural(Math.max(1, Math.round(diff / YEAR)), 'year', 'years')
}

/** "2d 4h", "4h 12m", "35m" — used for "Ch. 302 in 2d 4h" and "free in 23h". */
export const countdown = (until: Date | string | number, now: Date = new Date()): string => {
  const diff = Math.max(0, Math.round((toDate(until).getTime() - now.getTime()) / 1000))
  const d = Math.floor(diff / DAY)
  const h = Math.floor((diff % DAY) / HOUR)
  const m = Math.floor((diff % HOUR) / MINUTE)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${Math.max(1, m)}m`
}

/**
 * Chapter numbers are numeric(10,3): 12, 12.5, 7.1. Render without trailing zeros.
 * "Ch. 12.5" (short, default) · "Chapter 12.5" (long) · "#12.5" (hash).
 */
export const formatChapterNumber = (n: number | string): string => {
  const value = typeof n === 'string' ? Number.parseFloat(n) : n
  if (!Number.isFinite(value)) return String(n)
  return String(Number.parseFloat(value.toFixed(3)))
}

export const chapterLabel = (n: number | string, style: ChapterLabelStyle = 'short'): string => {
  const num = formatChapterNumber(n)
  switch (style) {
    case 'long':
      return `Chapter ${num}`
    case 'hash':
      return `#${num}`
    default:
      return `Ch. ${num}`
  }
}

/** Compact numbers: 81_300 → "81.3K", 1_200_000 → "1.2M". */
export const compactNumber = (n: number): string => {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${trim((n / 1000).toFixed(1))}K`
  if (n < 1_000_000_000) return `${trim((n / 1_000_000).toFixed(1))}M`
  return `${trim((n / 1_000_000_000).toFixed(1))}B`
}

/** Parses the brief's relative phrases ("12 min ago", "last week") into a Date. */
export const parseRelative = (phrase: string, now: Date = new Date()): Date => {
  const p = phrase.trim().toLowerCase()
  if (p === 'just now') return new Date(now)
  if (p === 'last week') return new Date(now.getTime() - WEEK * 1000)
  if (p === 'yesterday') return new Date(now.getTime() - DAY * 1000)
  const m =
    /^(\d+)\s*(min|mins|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago$/.exec(
      p,
    )
  if (!m?.[1] || !m[2]) throw new Error(`Cannot parse relative time: ${phrase}`)
  const n = Number.parseInt(m[1], 10)
  const unit = m[2]
  const secs = unit.startsWith('min')
    ? MINUTE
    : unit.startsWith('hour')
      ? HOUR
      : unit.startsWith('day')
        ? DAY
        : unit.startsWith('week')
          ? WEEK
          : unit.startsWith('month')
            ? MONTH
            : YEAR
  return new Date(now.getTime() - n * secs * 1000)
}

export const toIso = (d: Date): string => d.toISOString()

const toDate = (d: Date | string | number): Date => (d instanceof Date ? d : new Date(d))
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many} ago`
const trim = (s: string) => s.replace(/\.0$/, '')
