import { fmt, messages } from '@palscans/core/messages'
import { cn } from './cn'

export interface RatingStarsProps {
  /** 0–10 rating; rendered as five stars. */
  value: number
  count?: number
  showValue?: boolean
  size?: number
  className?: string
}

function Star({ fill, size }: { fill: number; size: number }) {
  const id = `star-${Math.round(fill * 100)}`
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id}>
          <stop offset={`${fill * 100}%`} stopColor="var(--color-gold)" />
          <stop offset={`${fill * 100}%`} stopColor="var(--color-surface-3)" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.8L12 17.7 5.9 21l1.3-6.8-5-4.7 6.8-.8z"
        fill={`url(#${id})`}
      />
    </svg>
  )
}

export function RatingStars({
  value,
  count,
  showValue = true,
  size = 16,
  className,
}: RatingStarsProps) {
  const clamped = Math.max(0, Math.min(10, value))
  const stars = clamped / 2
  const ratingLabel = [
    fmt(messages.series.rated, { score: `${clamped.toFixed(1)} / 10` }),
    count === undefined
      ? undefined
      : fmt(messages.series.ratings, { n: count.toLocaleString('en') }),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <span
      role="img"
      aria-label={ratingLabel}
      className={cn('inline-flex items-center gap-1.5', className)}
    >
      <span className="inline-flex items-center gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} size={size} fill={Math.max(0, Math.min(1, stars - i))} />
        ))}
      </span>
      {showValue ? (
        <span className="font-display text-sm font-bold tabular-nums text-gold">
          {clamped.toFixed(1)}
        </span>
      ) : null}
      {count !== undefined ? (
        <span className="text-xs tabular-nums text-fg-subtle">({count.toLocaleString('en')})</span>
      ) : null}
    </span>
  )
}
