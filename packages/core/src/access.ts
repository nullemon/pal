import { entitlement } from './entitlements.js'
import { can, type SessionUser } from './permissions.js'

export type ChapterState =
  | 'draft'
  | 'processing'
  | 'ready'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'removed'

/** The minimal chapter shape access control needs. */
export interface ChapterAccessInput {
  state: ChapterState | string
  is_premium: boolean
  early_access_until: Date | null
}

export type ChapterLock = 'none' | 'early_access' | 'premium' | 'unpublished'

/** Why a chapter is locked for the public, independent of the viewer. */
export const chapterLock = (chapter: ChapterAccessInput, now: Date = new Date()): ChapterLock => {
  if (chapter.state !== 'published') return 'unpublished'
  if (chapter.early_access_until && chapter.early_access_until.getTime() > now.getTime())
    return 'early_access'
  if (chapter.is_premium) return 'premium'
  return 'none'
}

/**
 * docs/07-auth-and-monetization.md — exists once. Route handlers, the page manifest and
 * the download endpoint all call this.
 */
export const canReadChapter = (
  user: SessionUser | null | undefined,
  chapter: ChapterAccessInput,
  now: Date = new Date(),
): boolean => {
  switch (chapterLock(chapter, now)) {
    case 'unpublished':
      return can(user, 'chapter.read')
    case 'early_access':
      return entitlement(user, 'early_access', now)
    case 'premium':
      return entitlement(user, 'premium_content', now)
    default:
      return true
  }
}

/** Ad-free is an entitlement granted by both tiers (docs/11). */
export const showsAds = (user: SessionUser | null | undefined, now: Date = new Date()): boolean =>
  !entitlement(user, 'no_ads', now)
