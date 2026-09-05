import { fmt, messages } from '@palscans/core/messages'
import { buttonClasses, EmptyState } from '@palscans/ui'
import { Search, Shuffle } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { cachedSearch } from '@/components/discovery/cached'
import { searchParamsSchema } from '@/components/discovery/filters'
import { pageMetadata } from '@/components/discovery/metadata'
import { withLatest } from '@/components/discovery/queries'
import { SeriesGrid } from '@/components/discovery/SeriesGrid'
import { siteCopy } from '@/lib/copy/settings'

/** /search?q= — full results page (noindex, docs/12 §1); the header form submits here. */
export async function generateMetadata({ searchParams }: PageProps<'/search'>): Promise<Metadata> {
  const { q } = searchParamsSchema.parse(await searchParams)
  return pageMetadata(
    'home',
    {},
    {
      path: '/search',
      noindex: true,
      override: {
        title: `${q ? fmt(messages.search.results, { q }) : messages.search.title} · ${messages.site.name}`,
        description: messages.search.hint,
      },
    },
  )
}

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const { q } = searchParamsSchema.parse(await searchParams)
  const hits = q ? await cachedSearch(q) : []
  const [items, copy] = await Promise.all([withLatest(hits), siteCopy()])

  return (
    <div className="container-page flex flex-col gap-4 pt-5">
      <header className="flex flex-col gap-3">
        <h1 className="section-title text-[22px] leading-7">
          {q ? fmt(messages.search.results, { q }) : messages.search.title}
        </h1>
        <form action="/search" method="get" className="flex max-w-[560px] items-center gap-2">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface-1 pl-3 pr-2 text-fg-muted focus-within:border-brand">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">{messages.nav.search}</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={messages.search.placeholder}
              autoComplete="off"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted"
            />
          </label>
          <button type="submit" className={buttonClasses('primary', 'md')}>
            {messages.nav.search}
          </button>
        </form>
      </header>

      {!q ? (
        <p className="text-[13px] text-fg-muted">{messages.discovery.searchEmptyPrompt}</p>
      ) : items.length === 0 ? (
        <EmptyState
          title={fmt(copy('search.empty'), { q })}
          description={messages.search.hint}
          action={
            <div className="flex gap-2">
              <Link href="/browse" className={buttonClasses('outline', 'sm')}>
                {messages.nav.browse}
              </Link>
              <Link href="/random" prefetch={false} className={buttonClasses('primary', 'sm')}>
                <Shuffle size={14} aria-hidden="true" />
                {messages.discovery.randomSeries}
              </Link>
            </div>
          }
        />
      ) : (
        <section aria-label={messages.search.title} className="flex flex-col gap-3">
          <p className="text-[13px] font-semibold text-fg-muted">
            {fmt(messages.discovery.results, { n: items.length })}
          </p>
          <SeriesGrid items={items} priorityCount={8} />
          {items.some((h) => h.matchedTitle) ? (
            <ul className="flex flex-col gap-1 text-[12px] text-fg-subtle">
              {items
                .filter((h) => h.matchedTitle)
                .slice(0, 5)
                .map((h) => (
                  <li key={h.id}>
                    <Link href={h.href} className="font-semibold text-fg-muted hover:text-fg">
                      {h.title}
                    </Link>{' '}
                    {fmt(messages.discovery.matchedAs, { title: h.matchedTitle ?? '' })}
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      )}
    </div>
  )
}
