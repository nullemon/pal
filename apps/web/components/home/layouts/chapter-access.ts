import {
  canReadChapter,
  chapterLock,
  countdown,
  type EntitlementOverrides,
  type SessionUser,
} from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import type { ChapterSummary } from '@/components/discovery/types'

const NEW_HOURS = 24

export interface ChapterAccess {
  /** The viewer may not read it yet: show the lock instead of a bare chapter link. */
  locked: boolean
  /** "free in 23h" / "Premium only", or null when the chapter is open. */
  lockLabel: string | null
  /** Published inside the NEW window. */
  isNew: boolean
}

/**
 * The lock/NEW state one chapter shows in a feed, shared by the alternate home layouts so
 * every direction gates identically (docs/07: the pure gates live in `@palscans/core`).
 */
export function chapterAccess(
  chapter: ChapterSummary,
  user: SessionUser | null,
  now: Date,
  overrides: EntitlementOverrides | null,
): ChapterAccess {
  const access = {
    state: 'published' as const,
    is_premium: chapter.isPremium,
    early_access_until: chapter.earlyAccessUntil ? new Date(chapter.earlyAccessUntil) : null,
  }
  const lock = chapterLock(access, now)
  const locked = lock !== 'none' && !canReadChapter(user, access, { overrides, now })
  const published = chapter.publishedAt ? new Date(chapter.publishedAt) : null
  return {
    locked,
    lockLabel: !locked
      ? null
      : lock === 'early_access' && access.early_access_until
        ? fmt(messages.series.earlyAccessFreeIn, {
            countdown: countdown(access.early_access_until, now),
          })
        : lock === 'premium'
          ? messages.series.premiumOnly
          : null,
    isNew: published !== null && now.getTime() - published.getTime() < NEW_HOURS * 3_600_000,
  }
}
