import { fmt, messages } from '@palscans/core/messages'
import { chapters, getDb, series } from '@palscans/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { ensureConfig } from '@/lib/config/install'
import { cardFingerprint, chapterOgPath, type OgCardText, seriesOgPath } from './og-card'

/**
 * What a share card needs from the database, and the `?v=` fingerprint the OG URL carries
 * (docs/12 §2). Cached under the `catalog` tag so a title or cover edit invalidates the URL
 * the next time the page is rendered rather than waiting for a TTL.
 */

export interface OgSeriesRow {
  id: number
  slug: string
  title: string
  type: (typeof series.$inferSelect)['type']
  status: (typeof series.$inferSelect)['status']
  coverKey: string | null
  coverColor: string | null
  chapterCount: number
  rating: number
  ratingCount: number
  noindex: boolean
}

const columns = {
  id: series.id,
  slug: series.slug,
  title: series.title,
  type: series.type,
  status: series.status,
  // The operator's own OG image wins over the cover as the card's art (docs/12 §9).
  coverKey: sql<string | null>`coalesce(${series.ogImageKey}, ${series.coverKey})`,
  coverColor: series.coverColor,
  chapterCount: series.chapterCount,
  ratingAvg: series.ratingAvg,
  ratingCount: series.ratingCount,
  noindex: series.noindex,
} as const

/** The published series behind a card, or null. Unpublished series get no share card. */
export const ogSeriesBySlug = unstable_cache(
  async (slug: string): Promise<OgSeriesRow | null> => {
    await ensureConfig()
    const db = await getDb()
    const [row] = await db
      .select(columns)
      .from(series)
      .where(and(eq(series.slug, slug), eq(series.state, 'published'), isNull(series.deletedAt)))
      .limit(1)
    if (!row) return null
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      type: row.type,
      status: row.status,
      coverKey: row.coverKey,
      coverColor: row.coverColor,
      chapterCount: row.chapterCount,
      rating: Number(row.ratingAvg ?? 0),
      ratingCount: row.ratingCount,
      noindex: row.noindex,
    }
  },
  ['og', 'series'],
  { revalidate: 300, tags: ['catalog'] },
)

/** Whether the chapter exists and is published — a card for a draft chapter would leak it. */
export const ogChapterExists = unstable_cache(
  async (seriesId: number, number: number): Promise<boolean> => {
    await ensureConfig()
    const db = await getDb()
    const [row] = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(
        and(
          eq(chapters.seriesId, seriesId),
          eq(chapters.number, number),
          eq(chapters.state, 'published'),
          isNull(chapters.deletedAt),
        ),
      )
      .limit(1)
    return !!row
  },
  ['og', 'chapter-exists'],
  { revalidate: 300, tags: ['catalog'] },
)

/** "Manhwa · Ongoing", the title, the chapter pill and the "301 chapters · 9.6" footer. */
export const seriesCardText = (row: OgSeriesRow, chapter: string | null): OgCardText => ({
  eyebrow: `${messages.series.type[row.type]} · ${messages.series.status[row.status]}`,
  title: row.title,
  chapter: chapter ? fmt(messages.readerUi.chapterTitle, { n: chapter }) : null,
  chapters:
    row.chapterCount > 0 ? fmt(messages.series.chapterCount, { n: row.chapterCount }) : null,
  rating: row.ratingCount > 0 ? row.rating.toFixed(1) : null,
})

/**
 * The fingerprint that versions a card URL. Everything the card draws is in it, so the same
 * data always yields the same URL (and the CDN's copy is reused), while a retitled series or
 * a replaced cover gets a new one.
 */
export const seriesCardVersion = (row: OgSeriesRow, chapter: string | null): string =>
  cardFingerprint([
    row.title,
    row.type,
    row.status,
    row.coverKey,
    row.coverColor,
    row.chapterCount,
    row.ratingCount > 0 ? row.rating.toFixed(1) : '',
    chapter,
  ])

export const seriesOgUrl = (row: OgSeriesRow): string =>
  seriesOgPath(row.slug, seriesCardVersion(row, null))

export const chapterOgUrl = (row: OgSeriesRow, chapter: string): string =>
  chapterOgPath(row.slug, chapter, seriesCardVersion(row, chapter))
