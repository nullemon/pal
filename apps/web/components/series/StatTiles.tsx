import { fmt, messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import { Bookmark, List, Star } from 'lucide-react'

export interface StatTilesProps {
  ratingAvg: number
  ratingCount: number
  chapterCount: number
  bookmarkCount: number
  className?: string
}

const compact = (n: number): string => {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

function Tile({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode
  value: string
  label: string
  tone: 'gold' | 'brand'
}) {
  return (
    <div className="flex h-[60px] items-center gap-3 rounded-[12px] border border-line bg-surface-1 px-3">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-[10px]',
          tone === 'gold' ? 'bg-gold/12 text-gold' : 'bg-brand-wash text-brand-hover',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-display text-lg font-bold leading-[22px] tabular-nums">
          {value}
        </span>
        <span className="block text-[12px] leading-4 text-fg-muted">{label}</span>
      </span>
    </div>
  )
}

/** Rating (one decimal, with count) · chapters · bookmarks (docs/06 "Stat trio", compact formatting). */
export function StatTiles({
  ratingAvg,
  ratingCount,
  chapterCount,
  bookmarkCount,
  className,
}: StatTilesProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Tile
        tone="gold"
        icon={<Star size={18} fill="currentColor" aria-hidden="true" />}
        value={ratingCount > 0 ? ratingAvg.toFixed(1) : '–'}
        label={fmt(messages.series.ratings, { n: ratingCount.toLocaleString('en') })}
      />
      <Tile
        tone="brand"
        icon={<List size={18} aria-hidden="true" />}
        value={chapterCount.toLocaleString('en')}
        label={messages.series.chapters}
      />
      <Tile
        tone="brand"
        icon={<Bookmark size={18} aria-hidden="true" />}
        value={compact(bookmarkCount)}
        label={messages.footer.bookmarks}
      />
    </div>
  )
}
