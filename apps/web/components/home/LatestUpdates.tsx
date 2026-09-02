import type { SessionUser } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { cn, EmptyState } from '@palscans/ui'
import { Clock3 } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { homeHref, type SeriesTypeValue } from '@/components/discovery/filters'
import { Pagination } from '@/components/discovery/Pagination'
import { SectionTitle } from '@/components/discovery/SectionTitle'
import type { PagedResult, UpdateItem } from '@/components/discovery/types'
import { SponsoredCard } from './SponsoredCard'
import { UpdateRow } from './UpdateRow'

const TABS: ReadonlyArray<{ type?: SeriesTypeValue; label: string }> = [
  { label: messages.discovery.all },
  { type: 'manhwa', label: messages.series.type.manhwa },
  { type: 'manga', label: messages.series.type.manga },
  { type: 'manhua', label: messages.series.type.manhua },
]

/** The grid cell the sponsored native card occupies (0-based; 5th cell, docs/11 "after…"). */
const AD_INDEX = 4

export interface LatestUpdatesProps {
  feed: PagedResult<UpdateItem>
  type?: SeriesTypeValue
  user: SessionUser | null
  now: Date
  /** Sponsored cell: `null` hides it entirely (ad-free or slot disabled). */
  sponsored: { placeholder: boolean } | null
}

/**
 * The primary module (docs/06): 2-column grid of update rows, type tabs and real `?page=`
 * pagination as links. The 5th cell is the `home_infeed` native ad.
 */
export function LatestUpdates({ feed, type, user, now, sponsored }: LatestUpdatesProps) {
  const cells: ReactNode[] = feed.items.map((item, i) => (
    <UpdateRow key={item.id} item={item} user={user} now={now} priority={i < 4} />
  ))
  if (sponsored && cells.length >= AD_INDEX) {
    cells.splice(AD_INDEX, 0, <SponsoredCard key="sponsored" placeholder={sponsored.placeholder} />)
  }
  return (
    <section aria-labelledby="latest-title" className="flex min-w-0 flex-col gap-2">
      <SectionTitle
        id="latest-title"
        title={messages.home.latestUpdates}
        icon={<Clock3 size={18} />}
      >
        <nav aria-label={messages.browse.type} className="flex gap-0.5 text-[12px] font-semibold">
          {TABS.map((t) => {
            const active = (t.type ?? undefined) === type
            return (
              <Link
                key={t.label}
                href={homeHref({ type: t.type })}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-md px-[9px] py-[3px] transition-colors duration-[120ms]',
                  active
                    ? 'bg-surface-2 text-fg'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>
      </SectionTitle>
      {feed.items.length === 0 ? (
        <EmptyState title={messages.home.emptyUpdates} />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">{cells}</div>
      )}
      <Pagination
        page={feed.page}
        totalPages={feed.totalPages}
        href={(n) => homeHref({ page: n, type })}
        className="mt-1.5"
      />
    </section>
  )
}
