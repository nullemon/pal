import {
  type ChapterLock,
  canReadChapter,
  chapterLock,
  type EntitlementArg,
  type SessionUser,
} from '@palscans/core'
import { DEFAULT_CHAPTER_LANGUAGE } from '@palscans/core/languages'
import {
  type ChapterPageRow,
  type ChapterWithPages,
  chapterList,
  chapters,
  chapterWithPages,
  getDb,
  readingProgress,
  series,
  seriesLanguages,
} from '@palscans/db'

import { and, eq, isNull } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import { ensureConfig } from '@/lib/config/install'
import { configMirror } from '@/lib/config/mirror'
import { signedStorageUrl } from '@/lib/storage'
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
  pages: Array<
    Pick<
      ChapterPageRow,
      'chapterId' | 'idx' | 'key' | 'remoteUrl' | 'width' | 'height' | 'blurHash' | 'variants'
    >
  >
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
    chapterId: p.chapterId,
    idx: p.idx,
    key: p.key,
    // Carried so `toReaderPages` can tell a stored page from one left on its host (9046).
    remoteUrl: p.remoteUrl,
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
  language: string,
): Promise<ChapterBundle | null> => {
  const db = await getDb()
  const c = await chapterWithPages(db, seriesId, number, { includeUnpublished, language })
  return c ? toBundle(c) : null
}

// `language` is an argument, not part of the key prefix: unstable_cache keys on the argument
// list, so German and English chapter 12 are separate entries rather than one overwriting the
// other — which would serve whichever was read most recently to everybody.
const cachedBundle = unstable_cache(
  (seriesId: number, number: number, language: string) =>
    loadBundle(seriesId, number, false, language),
  ['reader', 'chapter'],
  { revalidate: CHAPTER_REVALIDATE, tags: ['catalog'] },
)

/**
 * Public readers hit the data cache; staff previews of unpublished chapters bypass it. A
 * cached miss is re-checked against the database: the worker publishes chapters out of
 * process, and a 404 must not outlive the chapter going live.
 */
export const readerChapter = cache(
  async (
    seriesId: number,
    number: number,
    includeUnpublished: boolean,
    language: string = DEFAULT_CHAPTER_LANGUAGE,
  ): Promise<ChapterBundle | null> => {
    if (includeUnpublished) return loadBundle(seriesId, number, true, language)
    return (
      (await cachedBundle(seriesId, number, language)) ??
      loadBundle(seriesId, number, false, language)
    )
  },
)

export const accessInput = (c: ChapterBundle['chapter']) => ({
  state: c.state,
  is_premium: c.isPremium,
  early_access_until: c.earlyAccessUntil ? new Date(c.earlyAccessUntil) : null,
})

/** `arg` carries the operator's entitlement overrides as well as the clock (docs/17 §B). */
export const viewerCanRead = (
  user: SessionUser | null,
  c: ChapterBundle['chapter'],
  arg: EntitlementArg,
): boolean => canReadChapter(user, accessInput(c), arg)

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
  async (
    seriesId: number,
    now: Date,
    language: string = DEFAULT_CHAPTER_LANGUAGE,
  ): Promise<ChapterListEntry[]> => {
    const db = await getDb()
    // The chapter select beside the reader lists this language only; a mixed list numbered
    // 1,1,2,2,3 is not something a reader can navigate.
    const rows = await chapterList(db, seriesId, 'asc', { language })
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
  await ensureConfig()
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
  await ensureConfig()
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
  const { driver, cdnUrl } = configMirror()
  if (driver === 'fs') return `/_storage/${safe}`
  return `${cdnUrl.replace(/\/+$/, '')}/${safe}`
}

/**
 * Page rows → what the island renders. Only ever called after `viewerCanRead`. Free
 * chapters get plain immutable CDN URLs; a locked chapter (premium / early access) gets
 * URLs signed for 10 minutes (docs/03 "Paid content"), so an entitled reader's DOM or HAR
 * never turns into a permanent public link to paid pages.
 */
export const toReaderPages = async (
  pages: ChapterBundle['pages'],
  lock: ChapterLock,
): Promise<ReaderPage[]> => {
  await ensureConfig()
  const url = lock === 'none' ? async (key: string) => storageUrl(key) : signedStorageUrl
  return Promise.all(
    pages.map(async (p) => {
      /**
       * A page imported from a gallery and left there (migration 9046).
       *
       * A free chapter is served straight from the host. The proxy hop is real cost — reader
       * to our edge, to a one-core box, to the host, and back — and on a cache miss it is
       * slower than the origin it is hiding. For a page anyone may read, hiding it buys
       * nothing worth that.
       *
       * A locked chapter still goes through `/p/`, because that is where the entitlement
       * check lives. Handing out `cdn.imgchest.com/...` for a premium page would make it
       * readable by anyone who viewed source, and the paywall decorative. The lock is read
       * per request, so a chapter that later becomes premium moves behind the proxy on its
       * own — nothing to migrate.
       *
       * No variants either way: nothing was encoded, so the single URL is all there is and a
       * srcset would be three copies of it.
       */
      if (p.remoteUrl)
        return {
          idx: p.idx,
          width: p.width,
          height: p.height,
          blurHash: p.blurHash,
          url: lock === 'none' ? p.remoteUrl : `/p/${p.chapterId}/${p.idx}`,
          variants: [],
        }
      const sized = p.variants
        .filter((v) => typeof v.w === 'number' && v.w > 0)
        .sort((a, b) => a.w - b.w)
      const variants: PageVariantUrl[] = await Promise.all(
        sized.map(async (v) => ({ w: v.w, url: await url(v.key ?? p.key) })),
      )
      return {
        idx: p.idx,
        width: p.width,
        height: p.height,
        blurHash: p.blurHash,
        url: await url(p.key),
        variants,
      }
    }),
  )
}

/**
 * The translations of this series, and whether each one has the chapter number being read.
 *
 * `hasThisNumber` is what lets the switcher keep the reader's place: switching to German on
 * chapter 40 should open German chapter 40, not German chapter 1 and not a 404. When that
 * number has no translation the caller sends them to the series page instead, which is the
 * honest answer rather than a dead link.
 */
export const readerLanguages = cache(
  async (
    seriesId: number,
    number: number,
  ): Promise<Array<{ language: string; chapters: number; hasThisNumber: boolean }>> => {
    const db = await getDb()
    const langs = await seriesLanguages(db, seriesId)
    if (langs.length < 2) return []
    const rows = await db
      .select({ language: chapters.language })
      .from(chapters)
      .where(
        and(
          eq(chapters.seriesId, seriesId),
          eq(chapters.number, number),
          eq(chapters.state, 'published'),
          isNull(chapters.deletedAt),
        ),
      )
    const here = new Set(rows.map((r) => r.language))
    return langs.map((l) => ({ ...l, hasThisNumber: here.has(l.language) }))
  },
)
