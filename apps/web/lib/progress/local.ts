import { allPositions, clearPositions, prunePositions, putPosition, putPositions } from './db'
import {
  forgetJournal,
  mergeRows,
  newestPerSeries,
  readJournal,
  rememberInJournal,
} from './journal'
import { type LocalProgress, MAX_LOCAL_ROWS } from './types'

/**
 * Local reading progress, as the rest of the app sees it.
 *
 * Two stores sit behind this (see `journal.ts` and `db.ts`): a small synchronous
 * localStorage journal that always lands, and a larger IndexedDB index that holds the long
 * tail. Reads fold the two together, newest write per chapter wins, and every path
 * degrades to "no progress" rather than throwing — a reader in private browsing sees a
 * site with no continue-reading rail, not a broken one.
 *
 * None of this is synced. It belongs to one browser on one device, and every surface that
 * shows it says so.
 */

export type { LocalProgress } from './types'

/** True when *anything* can be remembered on this device. */
export const localProgressSupported = (): boolean => {
  try {
    const probe = '__palscans_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return typeof indexedDB !== 'undefined'
  }
}

/** Save one position. Synchronous half first, so it survives a tab closing mid-write. */
export const rememberLocalProgress = (row: LocalProgress): void => {
  rememberInJournal(row)
  void putPosition(row).then((ok) => {
    if (ok && Math.random() < 0.05) void prunePositions(MAX_LOCAL_ROWS)
  })
}

/** The stored position for one chapter, from the journal only — synchronous, for boot. */
export const localResume = (chapterId: number): LocalProgress | null =>
  readJournal().find((r) => r.chapterId === chapterId) ?? null

/** Every stored position, newest first, both halves folded together. */
export const allLocalProgress = async (): Promise<LocalProgress[]> =>
  mergeRows(readJournal(), await allPositions())

/** The local "Continue reading" rail: the newest position in each series. */
export const localContinueReading = async (limit = 12): Promise<LocalProgress[]> =>
  newestPerSeries(await allLocalProgress()).slice(0, Math.max(0, limit))

/** The local history: every chapter this device opened, newest first. */
export const localHistory = async (limit = 200): Promise<LocalProgress[]> =>
  (await allLocalProgress()).slice(0, Math.max(0, limit))

/**
 * Copy anything the journal holds that IndexedDB does not into IndexedDB. Called on reader
 * mount: it is where positions saved during a `pagehide` that never got to commit an
 * IndexedDB transaction are finally written down.
 */
export const reconcileLocalProgress = async (): Promise<void> => {
  const journal = readJournal()
  if (journal.length === 0) return
  const stored = new Map((await allPositions()).map((r) => [r.chapterId, r]))
  const behind = journal.filter((r) => (stored.get(r.chapterId)?.updatedAt ?? -1) < r.updatedAt)
  // The journal only ever holds the newest rows, so IndexedDB is the half that remembers
  // further back; the reverse copy is deliberately not made.
  if (behind.length > 0) await putPositions(behind)
}

/** Forget everything this device remembers — "Clear history" for a signed-out reader. */
export const clearLocalProgress = async (): Promise<void> => {
  forgetJournal()
  await clearPositions()
}
