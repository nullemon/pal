import type { PopularityWindow } from '@palscans/core'
import { type ChapterLabelStyle, formatChapterLabel } from '@palscans/core/formatting'
import { messages } from '@palscans/core/messages'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import type { RankedSeries } from '@/components/discovery/types'
import { siteFormatting } from '@/lib/copy/settings'
import { type PopularRowData, PopularTabs } from './PopularTabs'

const toRow = (s: RankedSeries, chapterStyle: ChapterLabelStyle): PopularRowData => ({
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
    s.latest ? formatChapterLabel(s.latest.number, chapterStyle) : null,
  ]
    .filter(Boolean)
    .join(' · '),
  rating: s.ratingCount > 0 ? s.rating : null,
  mature: s.mature,
})

/** Server side of the Popular card: fetches nothing itself, just shapes the three lists. */
export async function PopularSidebar({
  lists,
}: {
  lists: Record<PopularityWindow, RankedSeries[]>
}) {
  const { chapterLabel: chapterStyle } = await siteFormatting()
  return (
    <PopularTabs
      lists={{
        weekly: lists.weekly.map((r) => toRow(r, chapterStyle)),
        monthly: lists.monthly.map((r) => toRow(r, chapterStyle)),
        all: lists.all.map((r) => toRow(r, chapterStyle)),
      }}
    />
  )
}
