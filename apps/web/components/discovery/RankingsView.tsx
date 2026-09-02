import { compactNumber, type PopularityWindow } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import { Trophy } from 'lucide-react'
import Link from 'next/link'
import { Rating, StatusBadge, TypeBadge } from './Badges'
import { JsonLd } from './JsonLd'
import { COVER_HEIGHT, COVER_WIDTH } from './media'
import { siteUrl } from './metadata'
import type { RankedSeries } from './types'

export const RANKING_WINDOWS: ReadonlyArray<{
  key: PopularityWindow
  segment: string | null
  label: string
}> = [
  { key: 'weekly', segment: null, label: messages.rankings.weekly },
  { key: 'monthly', segment: 'monthly', label: messages.rankings.monthly },
  { key: 'all', segment: 'all-time', label: messages.rankings.allTime },
]

export const rankingsPath = (window: PopularityWindow): string => {
  const w = RANKING_WINDOWS.find((x) => x.key === window)
  return w?.segment ? `/rankings/${w.segment}` : '/rankings'
}

export const windowForSegment = (segment: string): PopularityWindow | null =>
  RANKING_WINDOWS.find((w) => w.segment === segment)?.key ?? null

/** /rankings — the three windows as real pages, top 50 numbered rows, ItemList JSON-LD. */
export function RankingsView({
  window,
  items,
}: {
  window: PopularityWindow
  items: RankedSeries[]
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: messages.nav.home, item: siteUrl('/') },
          {
            '@type': 'ListItem',
            position: 2,
            name: messages.rankings.title,
            item: siteUrl(rankingsPath(window)),
          },
        ],
      },
      {
        '@type': 'ItemList',
        name: `${messages.rankings.title} · ${RANKING_WINDOWS.find((w) => w.key === window)?.label ?? ''}`,
        itemListElement: items.slice(0, 10).map((s) => ({
          '@type': 'ListItem',
          position: s.rank,
          url: siteUrl(s.href),
          name: s.title,
        })),
      },
    ],
  }
  return (
    <div className="container-page flex flex-col gap-4 pt-5">
      <JsonLd data={jsonLd} />
      <header className="flex flex-col gap-1">
        <h1 className="section-title flex items-center gap-2 text-[22px] leading-7">
          <Trophy size={20} className="text-brand-hover" aria-hidden="true" />
          {messages.rankings.title}
        </h1>
        <p className="text-[13px] text-fg-muted">
          {fmt(messages.discovery.rankingsIntro, { site: messages.site.name })}
        </p>
      </header>
      <nav
        aria-label={messages.rankings.title}
        className="flex gap-3 border-b border-line text-[13px] font-semibold"
      >
        {RANKING_WINDOWS.map((w) => (
          <Link
            key={w.key}
            href={rankingsPath(w.key)}
            aria-current={w.key === window ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-1 pb-2 transition-colors duration-[120ms]',
              w.key === window
                ? 'border-brand text-fg'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {w.label}
          </Link>
        ))}
      </nav>
      <ol className="grid gap-2 md:grid-cols-2">
        {items.map((s) => (
          <li key={s.id}>
            <article className="flex h-[88px] items-center gap-3 rounded-[10px] border border-line bg-surface-1 p-2 transition-colors duration-[120ms] hover:border-fg-subtle">
              <span
                className={cn(
                  'w-9 shrink-0 text-center font-display text-[22px] font-extrabold tabular-nums leading-none',
                  s.rank <= 3 ? 'text-brand-hover' : 'text-fg-subtle',
                )}
              >
                <span aria-hidden="true">{s.rank}</span>
                <span className="sr-only">{fmt(messages.series.rank, { n: s.rank })}</span>
              </span>
              <Link
                href={s.href}
                tabIndex={-1}
                aria-hidden="true"
                className="group block h-[72px] w-12 shrink-0 overflow-hidden rounded-[5px] bg-surface-2"
              >
                <img
                  src={s.coverSrc}
                  alt=""
                  width={COVER_WIDTH}
                  height={COVER_HEIGHT}
                  loading={s.rank <= 8 ? 'eager' : 'lazy'}
                  decoding="async"
                  className={cn(
                    'h-full w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.04]',
                    s.mature && 'blur-md',
                  )}
                />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link
                  href={s.href}
                  className="truncate text-[14px] font-bold leading-[18px] text-fg hover:text-brand-hover"
                >
                  {s.title}
                </Link>
                <div className="flex items-center gap-1.5">
                  <TypeBadge type={s.type} />
                  {s.status !== 'ongoing' ? <StatusBadge status={s.status} /> : null}
                  <Rating value={s.rating} count={s.ratingCount} />
                </div>
                <p className="truncate text-[12px] text-fg-muted">
                  {s.latest ? fmt(messages.series.chapterShort, { n: s.latest.number }) : null}
                  {s.latest ? ' · ' : null}
                  {fmt(messages.discovery.views, { n: compactNumber(s.views) })}
                </p>
              </div>
            </article>
          </li>
        ))}
      </ol>
      {items.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-fg-subtle">{messages.home.emptyUpdates}</p>
      ) : null}
    </div>
  )
}
