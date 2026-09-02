import type { PopularityWindow } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import type { RankedSeries } from '@/components/discovery/types'
import { type PopularRowData, PopularTabs } from './PopularTabs'

const toRow = (s: RankedSeries): PopularRowData => ({
  id: s.id,
  rank: s.rank,
  title: s.title,
  href: s.href,
  coverSrc: s.coverSrc,
  coverWidth: COVER_WIDTH,
  coverHeight: COVER_HEIGHT,
  meta: [
    messages.series.type[s.type],
    messages.series.status[s.status],
    s.latest ? fmt(messages.series.chapterShort, { n: s.latest.number }) : null,
  ]
    .filter(Boolean)
    .join(' · '),
  rating: s.ratingCount > 0 ? s.rating : null,
  mature: s.mature,
})

/** Server side of the Popular card: fetches nothing itself, just shapes the three lists. */
export function PopularSidebar({ lists }: { lists: Record<PopularityWindow, RankedSeries[]> }) {
  return (
    <PopularTabs
      lists={{
        weekly: lists.weekly.map(toRow),
        monthly: lists.monthly.map(toRow),
        all: lists.all.map(toRow),
      }}
    />
  )
}
