import { fmt, messages } from '@palscans/core/messages'
import type { SeriesType } from '@palscans/db'
import { storageUrl } from '@/lib/comments/media'

export interface RecommendedItem {
  id: number
  slug: string
  title: string
  type: SeriesType
  coverKey: string | null
  ratingAvg: number | null
  ratingCount: number
  chapterCount: number
}

/** Six covers: title, "9.4 · Ch. 154" (direction B). Internal links for SEO (docs/12 §10). */
export function RecommendedGrid({
  items,
  className,
}: {
  items: RecommendedItem[]
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="recommended-title" className={className}>
      <div className="flex h-6 items-baseline justify-between">
        <h2
          id="recommended-title"
          className="m-0 font-display text-xl font-bold tracking-[-0.01em]"
        >
          {messages.series.recommended}
        </h2>
        <a href="/browse" className="text-[13px] font-medium text-fg-muted hover:text-fg">
          {messages.seriesDetail.moreLikeThis}
        </a>
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((s) => {
          const src = storageUrl(s.coverKey)
          const rating =
            s.ratingCount > 0 && s.ratingAvg !== null ? Number(s.ratingAvg).toFixed(1) : null
          return (
            <li key={s.id} className="min-w-0">
              <a href={`/series/${s.slug}`} className="block min-w-0 text-fg">
                {src ? (
                  <img
                    src={src}
                    alt={fmt(messages.seriesDetail.coverAlt, { title: s.title })}
                    width={200}
                    height={300}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[2/3] h-auto w-full rounded-[10px] object-cover shadow-2"
                  />
                ) : (
                  <span className="block aspect-[2/3] w-full rounded-[10px] bg-surface-3" />
                )}
                <span className="mt-2 block truncate text-[13px] font-semibold leading-[18px]">
                  {s.title}
                </span>
                <span className="block text-[13px] leading-[18px] text-fg-muted">
                  {rating ? `${rating} · ` : ''}
                  {fmt(messages.series.chapterShort, { n: s.chapterCount })}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
