import { allLocalProgress } from './local'

/**
 * The join: an anonymous reader signs in, and everything this device remembers is offered
 * to the account rather than thrown away. That moment is the whole point of keeping local
 * progress at all — a reader who has been reading signed out for a week and finally makes
 * an account must not find an empty "Continue reading".
 *
 * The client's only job is to hand over what it has, with each position's *age*; the
 * server decides every conflict, under the same rule as an ordinary write
 * (`@palscans/db` `queries/progress.ts`). Nothing local is deleted: the reader may sign out
 * again, and the account row is not this device's to prune.
 */

/** Marks which account this device has already been folded into. */
export const MERGED_KEY = 'palscans.progress.merged.v1'

/** The server takes at most this many; sending more is wasted bytes on both ends. */
export const MERGE_LIMIT = 200

export interface MergeResult {
  userId: number
  read: number
  advanced: number
  kept: number
  skipped: number
}

const alreadyMerged = (userId: number): boolean => {
  try {
    return window.localStorage.getItem(MERGED_KEY) === String(userId)
  } catch {
    return false
  }
}

const markMerged = (userId: number): void => {
  try {
    window.localStorage.setItem(MERGED_KEY, String(userId))
  } catch {
    // no storage: the merge is idempotent, so a repeat next visit is harmless
  }
}

/**
 * Offer this device's positions to the signed-in account. A no-op when there is nothing to
 * offer or when this device has already been merged into this account. Never throws.
 */
export const mergeDeviceProgress = async (): Promise<MergeResult | null> => {
  const rows = await allLocalProgress()
  if (rows.length === 0) return null
  const now = Date.now()
  const body = JSON.stringify({
    positions: rows.slice(0, MERGE_LIMIT).map((r) => ({
      chapterId: r.chapterId,
      pageIdx: r.pageIdx,
      scrollPct: Math.round(r.scrollPct * 1000) / 1000,
      // An age, not a clock reading — see the rule in @palscans/db queries/progress.ts.
      observedAgoMs: Math.max(0, now - r.updatedAt),
    })),
  })
  try {
    const res = await fetch('/api/progress/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: MergeResult }
    const data = json.data
    if (!data) return null
    markMerged(data.userId)
    return data
  } catch {
    return null
  }
}

/** `mergeDeviceProgress`, skipped when this device is already folded into this account. */
export const mergeDeviceProgressOnce = async (userId: number): Promise<MergeResult | null> => {
  if (alreadyMerged(userId)) return null
  return mergeDeviceProgress()
}
