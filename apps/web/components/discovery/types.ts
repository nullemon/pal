import type { SeriesStatusValue, SeriesTypeValue } from './filters'

/**
 * Serialisable view models for the discovery surfaces. Dates are ISO strings so the same
 * shape survives the data cache (`unstable_cache` JSON-serialises) and can cross into client
 * islands; `<time datetime>` wants ISO anyway (docs/06).
 */
export interface SeriesSummary {
  id: number
  slug: string
  title: string
  type: SeriesTypeValue
  status: SeriesStatusValue
  coverSrc: string
  coverColor: string | null
  rating: number
  ratingCount: number
  chapterCount: number
  bookmarkCount: number
  viewCount: number
  lastChapterAt: string | null
  isPinned: boolean
  isFeatured: boolean
  mature: boolean
  href: string
}

export interface ChapterSummary {
  id: number
  number: number
  title: string | null
  isPremium: boolean
  earlyAccessUntil: string | null
  publishedAt: string | null
  href: string
}

export interface UpdateItem extends SeriesSummary {
  chapters: ChapterSummary[]
}

export interface HeroSlide extends SeriesSummary {
  synopsis: string | null
  latest: ChapterSummary | null
}

export interface RankedSeries extends SeriesSummary {
  rank: number
  views: number
  latest: ChapterSummary | null
}

export interface ContinueItem extends SeriesSummary {
  chapter: ChapterSummary
  readAt: string
}

export interface AnnouncementSummary {
  slug: string
  title: string
  excerpt: string | null
  publishedAt: string | null
  href: string
}

export interface PagedResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface GenreSummary {
  id: number
  slug: string
  name: string
  kind: string
  count: number
  href: string
}
