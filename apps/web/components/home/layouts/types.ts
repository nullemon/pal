import type { EntitlementOverrides, PopularityWindow, SessionUser } from '@palscans/core'
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
  /** Which sections `settings.home_layout` leaves enabled. */
  sections: { latest: boolean }
  ads: { top: AdPlacement; sidebar: AdPlacement; infeed: AdPlacement }
}

export type HomeLayoutComponent = (props: HomeViewProps) => ReactNode
