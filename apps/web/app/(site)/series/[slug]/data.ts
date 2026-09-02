import { canReadChapter, chapterLock, type EntitlementOverrides } from '@palscans/core'
import {
  bookmarks,
  chapterList,
  chapterReads,
  chapters,
  db,
  ratings,
  readingProgress,
  recommendedSeries,
  seriesBySlug,
  seriesRank,
} from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import { cache } from 'react'
import type { AppUser } from '@/lib/comments/viewer'

/** One series lookup per request, shared by `generateMetadata` and the page. */
export const getSeries = cache((slug: string) => seriesBySlug(db, slug))

export type ChapterLockKind = 'none' | 'early_access' | 'premium'

/** What the chapter table needs per row — serialisable for the client island. */
export interface ChapterRowData {
  id: number
  number: number
  title: string | null
  publishedAt: string | null
  earlyAccessUntil: string | null
  lock: ChapterLockKind
  canRead: boolean
  pageCount: number
}

export interface ViewerSeriesState {
  progress: { chapterId: number; chapterNumber: number } | null
  bookmarkStatus: string | null
  rating: number | null
  readIds: number[]
}

const emptyState: ViewerSeriesState = {
  progress: null,
  bookmarkStatus: null,
  rating: null,
  readIds: [],
}

/** The viewer's relationship with a series: progress, bookmark, rating and read chapters. */
export const viewerSeriesState = async (
  user: AppUser | null,
  seriesId: number,
): Promise<ViewerSeriesState> => {
  if (!user) return emptyState
  const [progressRow, bookmarkRow, ratingRow, reads] = await Promise.all([
    db
      .select({ chapterId: readingProgress.chapterId, number: chapters.number })
      .from(readingProgress)
      .innerJoin(chapters, eq(chapters.id, readingProgress.chapterId))
      .where(and(eq(readingProgress.userId, user.id), eq(readingProgress.seriesId, seriesId)))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({ status: bookmarks.status })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, user.id), eq(bookmarks.seriesId, seriesId)))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({ score: ratings.score })
      .from(ratings)
      .where(and(eq(ratings.userId, user.id), eq(ratings.seriesId, seriesId)))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({ chapterId: chapterReads.chapterId })
      .from(chapterReads)
      .innerJoin(chapters, eq(chapters.id, chapterReads.chapterId))
      .where(and(eq(chapterReads.userId, user.id), eq(chapters.seriesId, seriesId))),
  ])
  return {
    progress: progressRow
      ? { chapterId: progressRow.chapterId, chapterNumber: Number(progressRow.number) }
      : null,
    bookmarkStatus: bookmarkRow?.status ?? null,
    rating: ratingRow?.score ?? null,
    readIds: reads.map((r) => r.chapterId),
  }
}

/** Published chapters, newest first, with the lock state resolved for this viewer. */
export const chapterRows = async (
  seriesId: number,
  user: AppUser | null,
  now: Date,
  /** `settings.entitlements` overrides (docs/17 §B) — a free feature unlocks the row. */
  overrides: EntitlementOverrides | null = null,
): Promise<ChapterRowData[]> => {
  const rows = await chapterList(db, seriesId, 'desc')
  return rows.map((c) => {
    const access = {
      state: c.state,
      is_premium: c.isPremium,
      early_access_until: c.earlyAccessUntil,
    }
    const lock = chapterLock(access, now)
    return {
      id: c.id,
      number: Number(c.number),
      title: c.title,
      publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
      earlyAccessUntil: c.earlyAccessUntil ? c.earlyAccessUntil.toISOString() : null,
      lock: lock === 'early_access' || lock === 'premium' ? lock : 'none',
      canRead: canReadChapter(user, access, { overrides, now }),
      pageCount: c.pageCount,
    }
  })
}

export const loadRank = (seriesId: number) => seriesRank(db, seriesId)
export const loadRecommended = (seriesId: number) => recommendedSeries(db, seriesId, 6)
