import { fmt, messages } from '@palscans/core/messages'
import { cn, SeriesCard, type SeriesType } from '@palscans/ui'
import { siteFormatting } from '@/lib/copy/settings'
import { COVER_HEIGHT, COVER_WIDTH } from './media'
import type { ChapterSummary, SeriesSummary } from './types'

/** packages/ui's `SeriesType` has no `novel` yet; render novels with the comic tint. */
export const uiType = (type: SeriesSummary['type']): SeriesType =>
  type === 'novel' ? 'comic' : type

export interface SeriesGridProps {
  items: ReadonlyArray<SeriesSummary & { latest?: ChapterSummary | null }>
  /** Eager-load the first N covers (above the fold). */
  priorityCount?: number
  className?: string
}

/** Responsive cover grid of `SeriesCard`s for browse, genres and search. */
export async function SeriesGrid({ items, priorityCount = 0, className }: SeriesGridProps) {
  const { chapterLabel: chapterStyle } = await siteFormatting()
  return (
    <ul
      className={cn(
        'grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8',
        className,
      )}
    >
      {items.map((s, i) => (
        <li key={s.id} className={cn('min-w-0', s.mature && '[&_img]:blur-md')}>
          <SeriesCard
            title={s.title}
            href={s.href}
            cover={{
              src: s.coverSrc,
              width: COVER_WIDTH,
              height: COVER_HEIGHT,
              alt: fmt(messages.discovery.coverAlt, { title: s.title }),
            }}
            type={uiType(s.type)}
            rating={s.ratingCount > 0 ? s.rating : undefined}
            priority={i < priorityCount}
            latestChapter={s.latest ? { number: s.latest.number, href: s.latest.href } : undefined}
            chapterLabelStyle={chapterStyle}
          />
        </li>
      ))}
    </ul>
  )
}
