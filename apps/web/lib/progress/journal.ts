import { type LocalProgress, MAX_LOCAL_ROWS } from './types'

/**
 * The synchronous half of local progress: one localStorage key holding the last
 * {@link JOURNAL_LIMIT} positions, newest first.
 *
 * IndexedDB is the roomy store (see `./db.ts`), but it is asynchronous, and the moment a
 * position most needs to survive is `pagehide` — a tab closing, a phone locking — where an
 * IndexedDB transaction opened in the last event loop turn may never commit. localStorage
 * writes are synchronous and land. So the journal is the record of truth for *whether a
 * position was saved*, and IndexedDB is a wider index rebuilt from it: every write goes to
 * both, and the reader reconciles the journal into IndexedDB on mount, catching up
 * anything the browser dropped on the way out.
 *
 * It is also the whole feature where IndexedDB is unavailable (Safari private browsing has
 * historically refused it): the rail and the history simply run off the journal's 60 rows.
 */

/** Bumped only on an incompatible shape change; a bad parse is dropped, never migrated. */
export const JOURNAL_KEY = 'palscans.progress.journal.v1'

/**
 * Enough that the "Continue reading" rail and a first page of history are complete for a
 * reader with no IndexedDB, small enough that the whole thing parses in well under a
 * millisecond on the reader's critical path.
 */
export const JOURNAL_LIMIT = 60

/**
 * The row validator, hand-written rather than a zod schema.
 *
 * This module runs on the reader's critical path — the journal is read before the first
 * paint so a resume does not flash — and zod is 84 KB gzipped, more than the whole budget
 * docs/06 gives the reader. The data being checked is our own, written by this file, in
 * this browser: the point of validating it is to survive a stale or hand-edited value, not
 * to defend a trust boundary. Untrusted input is still parsed with zod, on the server.
 *
 * Field semantics are kept exactly: an unusable row is dropped whole, while
 * `coverSrc`, `pageCount` and `scrollPct` fall back rather than disqualify it — the same
 * split `.catch()` expressed above.
 */
const int = (v: unknown, min: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min ? v : null

const str = (v: unknown, minLength = 0): string | null =>
  typeof v === 'string' && v.length >= minLength ? v : null

const parseRow = (v: unknown): LocalProgress | null => {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  const chapterId = int(r.chapterId, 1)
  const seriesId = int(r.seriesId, 1)
  const seriesSlug = str(r.seriesSlug, 1)
  const seriesTitle = str(r.seriesTitle)
  const seriesHref = str(r.seriesHref)
  const seriesType = str(r.seriesType)
  const chapterLabel = str(r.chapterLabel)
  const chapterHref = str(r.chapterHref)
  const pageIdx = int(r.pageIdx, 0)
  const updatedAt = int(r.updatedAt, 0)
  if (
    chapterId === null ||
    seriesId === null ||
    seriesSlug === null ||
    seriesTitle === null ||
    seriesHref === null ||
    seriesType === null ||
    chapterLabel === null ||
    chapterHref === null ||
    pageIdx === null ||
    updatedAt === null ||
    typeof r.chapterNumber !== 'number'
  )
    return null
  const scrollPct =
    typeof r.scrollPct === 'number' && r.scrollPct >= 0 && r.scrollPct <= 1 ? r.scrollPct : 0
  return {
    chapterId,
    seriesId,
    seriesSlug,
    seriesTitle,
    seriesHref,
    seriesType,
    coverSrc: typeof r.coverSrc === 'string' ? r.coverSrc : null,
    chapterNumber: r.chapterNumber,
    chapterLabel,
    chapterHref,
    pageIdx,
    pageCount: int(r.pageCount, 0) ?? 0,
    scrollPct,
    updatedAt,
  }
}

/** Rows that do not parse are dropped; a value that is not an array is an empty journal. */
const parseJournal = (v: unknown): LocalProgress[] =>
  Array.isArray(v) ? v.map(parseRow).filter((r): r is LocalProgress => r !== null) : []

/** Newest first. Never throws: a missing, unreadable or corrupt journal is an empty one. */
export const readJournal = (): LocalProgress[] => {
  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY)
    if (!raw) return []
    return parseJournal(JSON.parse(raw)).sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

/** True when the write landed. False in private mode, over quota, or with no storage. */
export const writeJournal = (rows: readonly LocalProgress[]): boolean => {
  try {
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(rows.slice(0, JOURNAL_LIMIT)))
    return true
  } catch {
    return false
  }
}

/**
 * Put one position at the head of the journal, replacing any earlier one for the same
 * chapter. Older positions for the same chapter are dropped rather than kept: this is a
 * resume record, not a log.
 */
export const rememberInJournal = (row: LocalProgress): boolean => {
  const next = [row, ...readJournal().filter((r) => r.chapterId !== row.chapterId)]
  return writeJournal(next)
}

export const forgetJournal = (): void => {
  try {
    window.localStorage.removeItem(JOURNAL_KEY)
  } catch {
    // nothing stored, nothing to clear
  }
}

/** Newest-per-chapter, capped — how the journal and IndexedDB are folded into one list. */
export const mergeRows = (...sources: ReadonlyArray<readonly LocalProgress[]>): LocalProgress[] => {
  const best = new Map<number, LocalProgress>()
  for (const rows of sources)
    for (const row of rows) {
      const prev = best.get(row.chapterId)
      if (!prev || row.updatedAt > prev.updatedAt) best.set(row.chapterId, row)
    }
  return [...best.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LOCAL_ROWS)
}

/** The newest position in each series, newest series first — the "Continue reading" rail. */
export const newestPerSeries = (rows: readonly LocalProgress[]): LocalProgress[] => {
  const best = new Map<number, LocalProgress>()
  for (const row of rows) {
    const prev = best.get(row.seriesId)
    if (!prev || row.updatedAt > prev.updatedAt) best.set(row.seriesId, row)
  }
  return [...best.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}
