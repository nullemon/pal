import { messages } from '@palscans/core/messages'
import type { SeriesGenreRef, SeriesPersonRef, SeriesTitleRef } from '@palscans/db'
import { cn } from '@palscans/ui'

export function GenreChips({
  genres,
  className,
}: {
  genres: SeriesGenreRef[]
  className?: string
}) {
  if (genres.length === 0) return null
  return (
    <div className={className}>
      <div className="text-[13px] font-semibold leading-[18px] text-fg-muted">
        {messages.series.genres}
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {genres.map((g) => (
          <li key={g.id}>
            <a
              href={`/genres/${g.slug}`}
              className="inline-flex h-7 items-center rounded-full border border-line bg-surface-1 px-[11px] text-[13px] font-medium text-fg transition-colors hover:border-brand"
            >
              {g.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

const creditLabel: Record<string, string> = {
  author: messages.series.author,
  artist: messages.series.artist,
  translator: messages.series.translator,
}

export function Credits({
  people,
  releasedYear,
  className,
}: {
  people: SeriesPersonRef[]
  releasedYear: number | null
  className?: string
}) {
  const order = ['author', 'artist', 'translator']
  const sorted = [...people].sort((a, b) => order.indexOf(a.credit) - order.indexOf(b.credit))
  return (
    <dl className={cn('flex flex-col gap-2 border-t border-line pt-4 text-sm', className)}>
      {sorted.map((p) => (
        <div
          key={`${p.credit}-${p.id}`}
          className="flex items-center justify-between gap-3 leading-[22px]"
        >
          <dt className="text-fg-muted">{creditLabel[p.credit] ?? p.credit}</dt>
          <dd className="m-0 min-w-0 truncate text-right">
            <a
              href={`/browse?person=${encodeURIComponent(p.slug)}`}
              className="font-semibold text-fg hover:text-brand-hover"
            >
              {p.name}
            </a>
          </dd>
        </div>
      ))}
      {releasedYear ? (
        <div className="flex items-center justify-between gap-3 leading-[22px]">
          <dt className="text-fg-muted">{messages.seriesDetail.released}</dt>
          <dd className="m-0 font-medium">{releasedYear}</dd>
        </div>
      ) : null}
    </dl>
  )
}

/** Alternative titles are what people search for (docs/12 §3) — server-rendered, never hidden from crawlers. */
export function AltTitles({ titles, className }: { titles: SeriesTitleRef[]; className?: string }) {
  if (titles.length === 0) return null
  return (
    <div className={cn('border-t border-line pt-4', className)}>
      <div className="text-[13px] font-semibold leading-[18px] text-fg-muted">
        {messages.series.alternativeTitles}
      </div>
      <ul className="mt-1.5 text-sm leading-[22px]">
        {titles.map((t) => (
          <li key={`${t.lang ?? ''}-${t.title}`} lang={t.lang ?? undefined}>
            {t.title}
          </li>
        ))}
      </ul>
    </div>
  )
}
