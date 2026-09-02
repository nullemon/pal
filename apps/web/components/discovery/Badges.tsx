import { messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import type { SeriesStatusValue, SeriesTypeValue } from './filters'

/** Solid type chip from the home mockup (white on the type colour). */
const typeClasses: Record<SeriesTypeValue, string> = {
  manhwa: 'bg-type-manhwa text-white',
  manhua: 'bg-type-manhua text-white',
  manga: 'bg-type-manga text-white',
  comic: 'bg-type-comic text-bg',
  novel: 'bg-surface-3 text-fg',
}

const base =
  'inline-flex h-[18px] shrink-0 items-center rounded-sm px-1.5 text-[10px] font-extrabold uppercase leading-none tracking-[0.08em] whitespace-nowrap'

export function TypeBadge({ type, className }: { type: SeriesTypeValue; className?: string }) {
  return (
    <span className={cn(base, typeClasses[type], className)}>{messages.series.type[type]}</span>
  )
}

const statusClasses: Record<SeriesStatusValue, string> = {
  ongoing: 'bg-status-ongoing/15 text-status-ongoing',
  completed: 'bg-status-completed/15 text-status-completed',
  hiatus: 'bg-status-hiatus/15 text-status-hiatus',
  cancelled: 'bg-status-cancelled/15 text-status-cancelled',
  dropped: 'bg-status-cancelled/15 text-status-cancelled',
}

export function StatusBadge({
  status,
  className,
}: {
  status: SeriesStatusValue
  className?: string
}) {
  return (
    <span className={cn(base, statusClasses[status], className)}>
      {messages.series.status[status]}
    </span>
  )
}

function Star({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
    </svg>
  )
}

/** Gold star + one-decimal value; nothing when the series has no ratings yet. */
export function Rating({
  value,
  count,
  size = 12,
  className,
}: {
  value: number
  count?: number
  size?: number
  className?: string
}) {
  if (count === 0 || value <= 0) return null
  return (
    <span
      role="img"
      className={cn(
        'inline-flex shrink-0 items-center gap-[3px] text-[12px] font-bold tabular-nums text-gold',
        className,
      )}
      aria-label={`${value.toFixed(1)} / 10`}
    >
      <Star size={size} />
      {value.toFixed(1)}
    </span>
  )
}
