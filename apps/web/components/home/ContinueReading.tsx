import { formatChapterLabel } from '@palscans/core/formatting'
import { fmt, messages } from '@palscans/core/messages'
import { Rail, SeriesCard } from '@palscans/ui'
import { BookOpen } from 'lucide-react'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import { SectionTitle } from '@/components/discovery/SectionTitle'
import { uiType } from '@/components/discovery/SeriesGrid'
import type { ContinueItem } from '@/components/discovery/types'
import { getSessionUser } from '@/lib/auth/session'
import { siteFormatting } from '@/lib/copy/settings'
import { DeviceContinueReading, MergeDeviceProgress } from '@/lib/progress/DeviceProgress'

/**
 * The highest-value module on the home page, above Trending. Each card's pill is
 * "Continue Ch. N" linking straight into the reader.
 *
 * Three states, in one component because the home layouts render it once and know nothing
 * about who is looking:
 *
 *   * signed in with progress — the account's rail, from `reading_progress`;
 *   * signed in with none — nothing to show, but this is also the first page a reader
 *     usually lands on after signing in, so it is where the browser hands over whatever it
 *     read while anonymous ({@link MergeDeviceProgress});
 *   * signed out — whatever this browser remembers, read after mount and labelled as
 *     belonging to the device, never to an account.
 */
export async function ContinueReading({ items }: { items: ContinueItem[] }) {
  const [user, { chapterLabel: chapterStyle }] = await Promise.all([
    getSessionUser(),
    siteFormatting(),
  ])

  if (!user) return <DeviceContinueReading />

  return (
    <>
      <MergeDeviceProgress userId={user.id} />
      {items.length === 0 ? null : (
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
                    chapter: formatChapterLabel(s.chapter.number, chapterStyle),
                  }),
                  href: s.chapter.href,
                }}
              />
            ))}
          </Rail>
        </section>
      )}
    </>
  )
}
