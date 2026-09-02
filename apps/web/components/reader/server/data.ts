import { type ChapterLock, canReadChapter, chapterLock, type SessionUser } from '@palscans/core'
import {
  type ChapterPageRow,
  type ChapterWithPages,
  chapterList,
  chapters,
  chapterWithPages,
  getDb,
  readingProgress,
  series,
} from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import { getEnv } from '@/lib/env'
import type { PageVariantUrl, ReaderPage } from '../types'

/** docs/06: chapter pages are immutable once published — cache their data for an hour. */
export const CHAPTER_REVALIDATE = 3600

export interface ReaderSeriesRow {
  id: number
  slug: string
  title: string
  type: (typeof series.$inferSelect)['type']
  readingDirection: (typeof series.$inferSelect)['readingDirection']
  coverKey: string | null
  coverColor: string | null
  commentsEnabled: boolean
  state: (typeof series.$inferSelect)['state']
  noindex: boolean
}

const seriesColumns = {
  id: series.id,
  slug: series.slug,
  title: series.title,
  type: series.type,
  readingDirection: series.readingDirection,
  coverKey: series.coverKey,
  coverColor: series.coverColor,
  commentsEnabled: series.commentsEnabled,
  state: series.state,
  noindex: series.noindex,
} as const

/**
 * The light series row the reader needs (the series page loads genres, people and titles
 * we never show). Staff may open unpublished series; everyone else gets published only.
 */
export const readerSeries = cache(
  async (slug: string, includeUnpublished: boolean): Promise<ReaderSeriesRow | null> => {
    const db = await getDb()
    const where = includeUnpublished
      ? and(eq(series.slug, slug), isNull(series.deletedAt))
      : and(eq(series.slug, slug), eq(series.state, 'published'), isNull(series.deletedAt))
    const [row] = await db.select(seriesColumns).from(series).where(where).limit(1)
    return row ?? null
  },
)

/** `chapterWithPages` with Dates as ISO strings so it survives the data cache. */
export interface ChapterBundle {
  chapter: {
    id: number
    seriesId: number
    number: number
    volume: number | null
    title: string | null
    state: ChapterWithPages['chapter']['state']
    isPremium: boolean
    earlyAccessUntil: string | null
    publishedAt: string | null
    pageCount: number
  }
  pages: Array<Pick<ChapterPageRow, 'idx' | 'key' | 'width' | 'height' | 'blurHash' | 'variants'>>
  prev: { id: number; number: number } | null
  next: { id: number; number: number } | null
}

const toBundle = (c: ChapterWithPages): ChapterBundle => ({
  chapter: {
    id: c.chapter.id,
    seriesId: c.chapter.seriesId,
    number: Number(c.chapter.number),
    volume: c.chapter.volume,
    title: c.chapter.title,
    state: c.chapter.state,
    isPremium: c.chapter.isPremium,
    earlyAccessUntil: c.chapter.earlyAccessUntil ? c.chapter.earlyAccessUntil.toISOString() : null,
    publishedAt: c.chapter.publishedAt ? c.chapter.publishedAt.toISOString() : null,
    pageCount: c.chapter.pageCount,
  },
  pages: c.pages.map((p) => ({
    idx: p.idx,
    key: p.key,
    width: p.width,
    height: p.height,
    blurHash: p.blurHash,
    variants: p.variants,
  })),
  prev: c.prev ? { id: c.prev.id, number: Number(c.prev.number) } : null,
  next: c.next ? { id: c.next.id, number: Number(c.next.number) } : null,
})

const loadBundle = async (
  seriesId: number,
  number: number,
  includeUnpublished: boolean,
): Promise<ChapterBundle | null> => {
  const db = await getDb()
  const c = await chapterWithPages(db, seriesId, number, { includeUnpublished })
  return c ? toBundle(c) : null
}

const cachedBundle = unstable_cache(
  (seriesId: number, number: number) => loadBundle(seriesId, number, false),
  ['reader', 'chapter'],
  { revalidate: CHAPTER_REVALIDATE, tags: ['catalog'] },
)

/** Public readers hit the data cache; staff previews of unpublished chapters bypass it. */
export const readerChapter = cache(
  (seriesId: number, number: number, includeUnpublished: boolean): Promise<ChapterBundle | null> =>
    includeUnpublished ? loadBundle(seriesId, number, true) : cachedBundle(seriesId, number),
)

export const accessInput = (c: ChapterBundle['chapter']) => ({
  state: c.state,
  is_premium: c.isPremium,
  early_access_until: c.earlyAccessUntil ? new Date(c.earlyAccessUntil) : null,
})

export const viewerCanRead = (
  user: SessionUser | null,
  c: ChapterBundle['chapter'],
  now: Date,
): boolean => canReadChapter(user, accessInput(c), now)

export const lockOf = (c: ChapterBundle['chapter'], now: Date): ChapterLock =>
  chapterLock(accessInput(c), now)

export interface ChapterListEntry {
  id: number
  number: number
  title: string | null
  lock: ChapterLock
}

/** Every published chapter of the series, ascending, for the chapter select. */
export const readerChapterList = cache(
  async (seriesId: number, now: Date): Promise<ChapterListEntry[]> => {
    const db = await getDb()
    const rows = await chapterList(db, seriesId, 'asc')
    return rows.map((r) => ({
      id: r.id,
      number: Number(r.number),
      title: r.title,
      lock: chapterLock(
        { state: r.state, is_premium: r.isPremium, early_access_until: r.earlyAccessUntil },
        now,
      ),
    }))
  },
)

/** The viewer's saved position when it is in this chapter (docs/06 "Resume"). */
export const readerResume = async (
  user: SessionUser | null,
  seriesId: number,
  chapterId: number,
): Promise<{ pageIdx: number; scrollPct: number } | null> => {
  if (!user) return null
  const db = await getDb()
  const [row] = await db
    .select({
      chapterId: readingProgress.chapterId,
      pageIdx: readingProgress.pageIdx,
      scrollPct: readingProgress.scrollPct,
    })
    .from(readingProgress)
    .where(and(eq(readingProgress.userId, user.id), eq(readingProgress.seriesId, seriesId)))
    .limit(1)
  if (!row || row.chapterId !== chapterId) return null
  return { pageIdx: row.pageIdx, scrollPct: row.scrollPct }
}

/** Chapter id → its series id and access fields, for the progress and pages endpoints. */
export const chapterForApi = async (chapterId: number) => {
  const db = await getDb()
  const [row] = await db
    .select({
      id: chapters.id,
      seriesId: chapters.seriesId,
      number: chapters.number,
      state: chapters.state,
      isPremium: chapters.isPremium,
      earlyAccessUntil: chapters.earlyAccessUntil,
    })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), isNull(chapters.deletedAt)))
    .limit(1)
  return row ?? null
}

/**
 * Public URL for a storage key. Mirrors the fs driver's `/_storage/<key>` (relative so it
 * works on any port) and the CDN base for S3/R2.
 */
export const storageUrl = (key: string): string => {
  const safe = key.split('/').map(encodeURIComponent).join('/')
  const env = getEnv()
  if (env.STORAGE_DRIVER === 'fs') return `/_storage/${safe}`
  return `${env.PUBLIC_CDN_URL.replace(/\/+$/, '')}/${safe}`
}

/** Page rows → what the island renders. Only ever called after `viewerCanRead`. */
export const toReaderPages = (pages: ChapterBundle['pages']): ReaderPage[] =>
  pages.map((p) => {
    const variants: PageVariantUrl[] = p.variants
      .filter((v) => typeof v.w === 'number' && v.w > 0)
      .map((v) => ({ w: v.w, url: storageUrl(v.key ?? p.key) }))
      .sort((a, b) => a.w - b.w)
    return {
      idx: p.idx,
      width: p.width,
      height: p.height,
      blurHash: p.blurHash,
      url: storageUrl(p.key),
      variants,
    }
  })
