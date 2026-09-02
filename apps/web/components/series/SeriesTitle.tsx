import { fmt, messages } from '@palscans/core/messages'
import type { SeriesStatus, SeriesType } from '@palscans/db'
import { cn, RelativeTime } from '@palscans/ui'
import { TrendingUp } from 'lucide-react'

export interface SeriesTitleProps {
  title: string
  type: SeriesType
  status: SeriesStatus
  releasedYear: number | null
  rank: number | null
  lastChapterAt: string | null
  className?: string
}

const pill =
  'inline-flex h-6 items-center gap-[5px] rounded-full px-2.5 text-[12px] font-semibold leading-none'

const statusTone: Record<SeriesStatus, string> = {
  ongoing: 'bg-status-ongoing/15 text-status-ongoing',
  completed: 'bg-status-completed/15 text-status-completed',
  hiatus: 'bg-status-hiatus/15 text-status-hiatus',
  cancelled: 'bg-status-cancelled/15 text-status-cancelled',
  dropped: 'bg-status-cancelled/15 text-status-cancelled',
}

/** H1 + type/status/year chips, rank and "Updated 12 min ago" (direction B header). */
export function SeriesTitle({
  title,
  type,
  status,
  releasedYear,
  rank,
  lastChapterAt,
  className,
}: SeriesTitleProps) {
  return (
    <div className={className}>
      <h1 className="m-0 font-display text-[28px] font-bold leading-[1.15] tracking-[-0.02em] md:text-[40px] md:leading-[48px]">
        {title}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={cn(pill, 'bg-brand/16 text-brand-hover')}>
          {messages.series.type[type]}
        </span>
        <span className={cn(pill, statusTone[status])}>{messages.series.status[status]}</span>
        {releasedYear ? (
          <span className={cn(pill, 'border border-line bg-surface-2 text-fg-muted')}>
            {releasedYear}
          </span>
        ) : null}
        {rank ? (
          <span className={cn(pill, 'bg-gold/12 text-gold')}>
            <TrendingUp size={12} aria-hidden="true" />
            {fmt(messages.series.rank, { n: rank })}
          </span>
        ) : null}
        {lastChapterAt ? (
          <span className="ml-1.5 text-[13px] font-medium text-fg-muted">
            {messages.seriesDetail.updated.replace('{time}', '')}
            <RelativeTime iso={lastChapterAt} />
          </span>
        ) : null}
      </div>
    </div>
  )
}
