import { fmt, messages } from '@palscans/core/messages'
import { Rail, SeriesCard } from '@palscans/ui'
import { BookOpen } from 'lucide-react'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import { SectionTitle } from '@/components/discovery/SectionTitle'
import { uiType } from '@/components/discovery/SeriesGrid'
import type { ContinueItem } from '@/components/discovery/types'

/**
 * Only for a signed-in reader with progress (docs/06): the highest-value module, above
 * Trending. Each card's pill is "Continue Ch. N" linking straight into the reader.
 */
export function ContinueReading({ items }: { items: ContinueItem[] }) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="continue-title" className="flex flex-col gap-2">
      <SectionTitle
        id="continue-title"
        title={messages.home.continueReading}
        icon={<BookOpen size={18} />}
        link={{ href: '/me/history', label: messages.account.history }}
      />
      <Rail label={messages.home.continueReading} itemWidth="140px">
        {items.map((s) => (
          <SeriesCard
            key={s.id}
            title={s.title}
            href={s.href}
            cover={{
              src: s.coverSrc,
              width: COVER_WIDTH,
              height: COVER_HEIGHT,
              alt: fmt(messages.discovery.coverAlt, { title: s.title }),
            }}
            type={uiType(s.type)}
            latestChapter={{
              number: fmt(messages.series.continueChapter, {
                chapter: fmt(messages.series.chapterShort, { n: s.chapter.number }),
              }),
              href: s.chapter.href,
            }}
          />
        ))}
      </Rail>
    </section>
  )
}
