import { fmt, messages } from '@palscans/core/messages'
import { buttonClasses, cn, EmptyState } from '@palscans/ui'
import { Shuffle, SlidersHorizontal } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ActiveFilters, BrowseFilters, SORT_LABELS } from '@/components/discovery/BrowseFilters'
import { cachedGenres } from '@/components/discovery/cached'
import {
  BROWSE_SORTS,
  browseHref,
  isFiltered,
  parseBrowseParams,
} from '@/components/discovery/filters'
import { pageMetadata } from '@/components/discovery/metadata'
import { Pagination } from '@/components/discovery/Pagination'
import { browseSeries, genreIdsFor, withLatest } from '@/components/discovery/queries'
import { SeriesGrid } from '@/components/discovery/SeriesGrid'
import { siteCopy } from '@/lib/copy/settings'

/**
 * /browse — dynamic (docs/06), canonical `/browse`; filtered variants carry `noindex`
 * (docs/12 §7 "Index browse with filters: off").
 */
export async function generateMetadata({ searchParams }: PageProps<'/browse'>): Promise<Metadata> {
  const params = parseBrowseParams(await searchParams)
  return pageMetadata(
    'home',
    {},
    {
      path: '/browse',
      noindex: isFiltered(params),
      override: {
        title: `${messages.browse.title} · ${messages.site.name}`,
        description: messages.discovery.browseIntro,
      },
    },
  )
}

export default async function BrowsePage({ searchParams }: PageProps<'/browse'>) {
  const params = parseBrowseParams(await searchParams)
  const [genres, include, exclude, copy] = await Promise.all([
    cachedGenres(),
    genreIdsFor(params.genre),
    genreIdsFor(params.exclude),
    siteCopy(),
  ])
  const result = await browseSeries({
    type: params.type,
    status: params.status,
    includeGenreIds: include.map((g) => g.id),
    excludeGenreIds: exclude.map((g) => g.id),
    minChapters: params.minChapters,
    minRating: params.minRating,
    sort: params.sort,
    page: params.page,
  })
  const items = await withLatest(result.items)

  return (
    <div className="container-page flex flex-col gap-4 pt-5">
      <header className="flex flex-col gap-1">
        <h1 className="section-title text-[22px] leading-7">{messages.browse.title}</h1>
        <p className="text-[13px] text-fg-muted">{messages.discovery.browseIntro}</p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <details
          className="group lg:hidden"
          open={isFiltered({ ...params, page: 1, sort: 'latest' })}
        >
          <summary
            className={buttonClasses(
              'outline',
              'sm',
              'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
            )}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            {messages.browse.filters}
          </summary>
          <BrowseFilters params={params} genres={genres} className="mt-3" />
        </details>
        <div className="hidden lg:block">
          <BrowseFilters params={params} genres={genres} />
        </div>

        <section aria-label={messages.browse.title} className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-fg-muted">
              {fmt(messages.browse.results, { n: result.total.toLocaleString('en') })}
            </p>
            <nav
              aria-label={messages.browse.sort}
              className="flex gap-0.5 text-[12px] font-semibold"
            >
              {BROWSE_SORTS.map((s) => (
                <Link
                  key={s}
                  href={browseHref({ ...params, sort: s, page: 1 })}
                  aria-current={s === params.sort ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-[9px] py-[3px] transition-colors duration-[120ms]',
                    s === params.sort
                      ? 'bg-surface-2 text-fg'
                      : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  {SORT_LABELS[s]}
                </Link>
              ))}
            </nav>
          </div>
          <ActiveFilters params={params} genres={genres} />
          {items.length === 0 ? (
            <EmptyState
              title={copy('browse.empty')}
              action={
                <div className="flex gap-2">
                  <Link href="/browse" className={buttonClasses('outline', 'sm')}>
                    {messages.browse.reset}
                  </Link>
                  <Link href="/random" prefetch={false} className={buttonClasses('primary', 'sm')}>
                    <Shuffle size={14} aria-hidden="true" />
                    {messages.discovery.randomSeries}
                  </Link>
                </div>
              }
            />
          ) : (
            <SeriesGrid items={items} priorityCount={8} />
          )}
          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            href={(n) => browseHref({ ...params, page: n })}
            className="mt-2"
          />
        </section>
      </div>
    </div>
  )
}
