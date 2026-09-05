import type { EntitlementOverrides, PopularityWindow, SessionUser } from '@palscans/core'
import type { CopyFn } from '@palscans/core/copy'
import type { FormattingSettings } from '@palscans/core/formatting'
import type { ReactNode } from 'react'
import type { HomeParams } from '@/components/discovery/filters'
import type {
  AnnouncementSummary,
  ContinueItem,
  GenreSummary,
  HeroSlide,
  PagedResult,
  RankedSeries,
  SeriesSummary,
  UpdateItem,
} from '@/components/discovery/types'

/**
 * One reserved ad placement, already resolved against `settings.ads` and the viewer's
 * `no_ads` entitlement: `show` is false when the slot is off or the reader is ad-free, and
 * `placeholder` is true while no network tag is configured (docs/11).
 */
export interface AdPlacement {
  show: boolean
  placeholder: boolean
  /**
   * The network's tag for this slot, from `Admin → Business → Ads`. Null until a network is
   * configured, which is when the reserved box renders empty (or as a dashed placeholder
   * outside production).
   */
  tag: string | null
}

/**
 * Everything any home layout needs, loaded once by `loadHomeView()` (docs/17 §F: layouts
 * "share the same data helpers"). Layouts are presentational — none of them queries.
 */
export interface HomeViewProps {
  params: HomeParams
  user: SessionUser | null
  /** Server render time; every countdown and "NEW" window is measured from it. */
  now: Date
  overrides: EntitlementOverrides | null
  slides: HeroSlide[]
  trending: RankedSeries[]
  feed: PagedResult<UpdateItem>
  popular: Record<PopularityWindow, RankedSeries[]> | null
  announcement: AnnouncementSummary | null
  newest: SeriesSummary[]
  resume: ContinueItem[]
  genres: GenreSummary[]
  /**
   * Appearance → Copy and Appearance → Formatting (docs/15), resolved once by
   * `loadHomeView()` like everything else here — a layout never reads a setting itself.
   * `copy('layouts.featured')` is the hero eyebrow; `formatting.chapterLabel` is the shape
   * of the "Ch. 301" pill on every card.
   */
  copy: CopyFn
  formatting: FormattingSettings
  /** Which sections `settings.home_layout` leaves enabled. */
  sections: { latest: boolean }
  ads: { top: AdPlacement; sidebar: AdPlacement; infeed: AdPlacement }
}

export type HomeLayoutComponent = (props: HomeViewProps) => ReactNode
