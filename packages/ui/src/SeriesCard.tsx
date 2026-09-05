import { type ChapterLabelStyle, formatChapterLabel } from '@palscans/core/formatting'
import { fmt, messages } from '@palscans/core/messages'
import { Chip } from './Chip'
import { cn } from './cn'
import type { CoverImage, SeriesType } from './types'

export interface SeriesCardProps {
  title: string
  href: string
  cover: CoverImage
  type: SeriesType
  latestChapter?: { number: number | string; href?: string }
  /**
   * Appearance → Formatting → Chapter label (docs/15). A prop rather than the
   * `FormatProvider` context every other formatting consumer reads, because this card is a
   * server component on the home page, the browse grid and every rail — reading a client
   * context here would turn all of them into client components, which is exactly the kind of
   * boundary crossing docs/20 charges for.
   */
  chapterLabelStyle?: ChapterLabelStyle
  rank?: number
  rating?: number
  /** Eager-load the cover (LCP candidates only). */
  priority?: boolean
  className?: string
}

export function SeriesCard({
  title,
  href,
  cover,
  type,
  latestChapter,
  chapterLabelStyle = 'short',
  rank,
  rating,
  priority = false,
  className,
}: SeriesCardProps) {
  const chapterLabel =
    latestChapter === undefined
      ? undefined
      : typeof latestChapter.number === 'number'
        ? formatChapterLabel(latestChapter.number, chapterLabelStyle)
        : latestChapter.number
  return (
    <article className={cn('group relative flex w-full flex-col gap-2', className)}>
      <a
        href={href}
        className="relative block overflow-hidden rounded-md bg-surface-2 shadow-2 focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
      >
        <img
          src={cover.src}
          alt={cover.alt ?? ''}
          width={cover.width}
          height={cover.height}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          className="aspect-[2/3] h-auto w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.04]"
        />
        {rank !== undefined ? (
          <span className="absolute -bottom-1 left-0 font-display text-[56px] font-extrabold leading-none tracking-[-0.05em] text-transparent [-webkit-text-stroke:2px_var(--color-fg)] group-hover:[-webkit-text-stroke:2px_var(--color-brand-hover)]">
            <span aria-hidden="true">{rank}</span>
            <span className="sr-only">{fmt(messages.series.rank, { n: rank })}</span>
          </span>
        ) : null}
        {rating !== undefined ? (
          <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-sm bg-bg/85 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-gold">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.8L12 17.7 5.9 21l1.3-6.8-5-4.7 6.8-.8z" />
            </svg>
            {rating.toFixed(1)}
          </span>
        ) : null}
      </a>
      <div className="flex min-w-0 flex-col gap-1">
        <a
          href={href}
          className="line-clamp-2 text-[13px] font-bold leading-4 text-fg hover:text-brand-hover"
        >
          {title}
        </a>
        <div className="flex items-center justify-between gap-2">
          <Chip variant="type" value={type} size="sm" />
          {chapterLabel !== undefined ? (
            latestChapter?.href ? (
              <a
                href={latestChapter.href}
                className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-fg-muted hover:bg-surface-3 hover:text-fg"
              >
                {chapterLabel}
              </a>
            ) : (
              <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-fg-muted">
                {chapterLabel}
              </span>
            )
          ) : null}
        </div>
      </div>
    </article>
  )
}
