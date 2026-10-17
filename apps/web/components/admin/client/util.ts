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

/**
 * Whether a chapter's pages can be edited in the page editor.
 *
 * The editor rewrites the processing document — reorder, delete, replace one page, insert
 * one — and that document describes the originals in our own bucket. A chapter imported in
 * remote mode has none: its pages are served from the host that already had them, and the
 * link would open an empty grid, which reads as a broken screen rather than as the
 * deliberate limit it is. The Mark column already says `Remote`, with the reason.
 *
 * Structurally typed rather than taking a row type, so this lives beside the other pure
 * helpers instead of inside a component file that a test cannot import.
 */
export const canEditPages = (chapter: {
  pageCount: number
  /** `@palscans/core/watermark`'s `WatermarkPageState`; `remote` is the one that excludes. */
  watermark: string
  deletedAt: string | null
}): boolean => chapter.pageCount > 0 && chapter.watermark !== 'remote' && !chapter.deletedAt

/**
 * Which chapter numbers in one bulk drop are claimed by more than one chapter.
 *
 * Returned as the keys the database would compare — `numeric(10,3)` — rather than the raw
 * strings the folder names parsed to. That matters twice over: `1` and `1.0` are one chapter
 * to the unique index, and a check that compares the typed text lets that pair through to a
 * server that has to refuse it.
 *
 * Pure and exported so the uploader can recompute it on every edit. The bulk plan's own
 * `duplicate_number` is a snapshot of the original folder names and blocks the Upload button;
 * leaving it frozen meant retyping the number — the only remedy an operator has — could never
 * clear the block.
 */
export const duplicateNumberKeys = (numbers: readonly string[]): Set<string> => {
  const count = new Map<string, number>()
  for (const raw of numbers) {
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n)) continue
    const key = n.toFixed(3)
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  return new Set([...count].filter(([, n]) => n > 1).map(([key]) => key))
}

/**
 * Spread chapters that claim the same number onto free decimals, in place.
 *
 * The drop that produces this is ordinary: two folders named `Chapter 7` and `Chapter 7 (2)`,
 * or a part-1/part-2 release whose names both read as 7. The remedy was to retype the numbers
 * by hand, one field at a time, which on a ten-chapter clash is why people give up and upload
 * them one by one instead.
 *
 * The first chapter claiming a number keeps it; the others take `7.1`, `7.2` and so on. That
 * ordering is the conventional one for a split release, and keeping the first in place means
 * the fix never moves a chapter that was already right.
 *
 * Numbers already claimed anywhere in the drop are skipped, so this cannot invent a second
 * clash while resolving the first. An entry whose number has not been typed yet is left
 * alone — it has its own warning, and guessing a number for it would be inventing data.
 *
 * Returns a new array, same length and order, so the caller can apply it row by row.
 */
export const resolveDuplicateNumbers = (numbers: readonly string[]): string[] => {
  const key = (n: number) => n.toFixed(3)
  const claimed = new Set<string>()
  for (const raw of numbers) {
    const n = Number.parseFloat(raw)
    if (Number.isFinite(n)) claimed.add(key(n))
  }
  const seen = new Set<string>()
  return numbers.map((raw) => {
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n)) return raw
    if (!seen.has(key(n))) {
      seen.add(key(n))
      return raw
    }
    // A later claim on a number already taken: walk the decimals under it for a free one.
    for (let step = 1; step <= 99; step++) {
      const candidate = Math.round((n + step / 10) * 1000) / 1000
      if (claimed.has(key(candidate))) continue
      claimed.add(key(candidate))
      seen.add(key(candidate))
      return formatChapterNumber(candidate)
    }
    return raw
  })
}
