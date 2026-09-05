import type { FormattingSettings } from '@palscans/core/formatting'
import type { ReactNode } from 'react'
import type {
  ChapterRowData,
  getSeries,
  loadRecommended,
  ViewerSeriesState,
} from '@/app/(site)/series/[slug]/data'
import type { AdPlacement } from '@/components/home/layouts/types'
import type { CommentSort } from '@/lib/comments/types'
import type { AppUser } from '@/lib/comments/viewer'

/** The series row every direction renders, as `seriesBySlug` returns it. */
export type SeriesDetail = NonNullable<Awaited<ReturnType<typeof getSeries>>>
export type RecommendedItems = Awaited<ReturnType<typeof loadRecommended>>

/**
 * Everything any series layout needs, loaded once by `loadSeriesView()` (docs/17 §F).
 * Layouts are presentational — none of them queries, and all of them render the same ad
 * slots, comments island, metadata and JSON-LD.
 */
export interface SeriesViewProps {
  series: SeriesDetail
  user: AppUser | null
  /** Server render time; chapter countdowns and "NEW" windows are measured from it. */
  now: Date
  /** Comment sort from `?sort=`. */
  sort: CommentSort
  chapters: ChapterRowData[]
  rank: number | null
  recommended: RecommendedItems
  state: ViewerSeriesState
  coverUrl: string | null
  coverAlt: string
  /** The viewer holds `offline` (docs/17 §B overrides applied). */
  canDownload: boolean
  /**
   * `entitlements.early_access_minutes` — how long a new chapter stays Premium-only. Drives
   * the countdown beside the chapter number and the strip that explains it; 0 means the
   * window is off and neither is shown.
   */
  earlyAccessMinutes: number
  site: { url: string; name: string }
  /** Appearance → Formatting (docs/15), resolved once by `loadSeriesView()`. */
  formatting: FormattingSettings
  ads: { top: AdPlacement; mpu: AdPlacement }
}

export type SeriesLayoutComponent = (props: SeriesViewProps) => ReactNode
