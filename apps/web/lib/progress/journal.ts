import { z } from 'zod'
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

const rowSchema = z.object({
  chapterId: z.number().int().positive(),
  seriesId: z.number().int().positive(),
  seriesSlug: z.string().min(1),
  seriesTitle: z.string(),
  seriesHref: z.string(),
  seriesType: z.string(),
  coverSrc: z.string().nullable().catch(null),
  chapterNumber: z.number(),
  chapterLabel: z.string(),
  chapterHref: z.string(),
  pageIdx: z.number().int().min(0),
  pageCount: z.number().int().min(0).catch(0),
  scrollPct: z.number().min(0).max(1).catch(0),
  updatedAt: z.number().int().min(0),
})

const journalSchema = z.array(rowSchema)

/** Newest first. Never throws: a missing, unreadable or corrupt journal is an empty one. */
export const readJournal = (): LocalProgress[] => {
  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY)
    if (!raw) return []
    const parsed = journalSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return []
    return [...parsed.data].sort((a, b) => b.updatedAt - a.updatedAt)
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
