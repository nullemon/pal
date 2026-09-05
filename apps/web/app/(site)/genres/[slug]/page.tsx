import { truncateWords } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import { pageWindow } from '@palscans/db'
import { buttonClasses, cn, EmptyState } from '@palscans/ui'
import { ChevronRight, Shuffle } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SORT_LABELS } from '@/components/discovery/BrowseFilters'
import { cachedBrowse, cachedBrowseTotal, cachedGenres } from '@/components/discovery/cached'
import {
  BROWSE_PAGE_SIZE,
  BROWSE_SORTS,
  browseHref,
  genrePageParamsSchema,
  slugSchema,
} from '@/components/discovery/filters'
import { JsonLd } from '@/components/discovery/JsonLd'
import { pageMetadata, siteUrl } from '@/components/discovery/metadata'
import { Pagination } from '@/components/discovery/Pagination'
import { genreDetail, withLatest } from '@/components/discovery/queries'
import { RichText, richTextToPlain } from '@/components/discovery/RichText'
import { SeriesGrid } from '@/components/discovery/SeriesGrid'

/**
 * /genres/[slug] — the highest-value SEO surface (docs/12 §3): H1 with the genre, the
 * admin-written intro rendered from structured JSON, the grid, the FAQ (also as FAQPage
 * JSON-LD), all server-rendered.
 */
const KIND_LABELS: Record<string, string> = {
  genre: messages.browse.genres,
  theme: messages.genres.themes,
  format: messages.genres.formats,
}

async function load(slugParam: string) {
  const parsed = slugSchema.safeParse(slugParam)
  if (!parsed.success) return null
  return genreDetail(parsed.data)
}

export async function generateMetadata({ params }: PageProps<'/genres/[slug]'>): Promise<Metadata> {
  const { slug } = await params
  const genre = await load(slug)
  if (!genre) return { title: messages.errors.notFound, robots: { index: false } }
  const intro = genre.intro
    ? richTextToPlain(genre.intro)
    : fmt(messages.discovery.genreIntroFallback, {
        genre: genre.name,
        site: messages.site.name,
        count: genre.count,
      })
  return pageMetadata(
    'genre',
    { genre: genre.name, count: genre.count, intro },
    {
      path: `/genres/${genre.slug}`,
      override: {
        title: genre.seoTitle ?? undefined,
        description: genre.seoDescription ?? undefined,
      },
    },
  )
}

export default async function GenrePage({ params, searchParams }: PageProps<'/genres/[slug]'>) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])
  const genre = await load(slug)
  if (!genre) notFound()
  const query = genrePageParamsSchema.parse(sp)
  // Count, clamp, page — the same three steps as `/browse`, and for the same reason: the
  // page number is part of the cache key, so it has to be a page that exists first.
  const filters = {
    includeGenreIds: [genre.id],
    excludeGenreIds: [],
    minChapters: 0,
    minRating: 0,
  }
  const [total, genres] = await Promise.all([cachedBrowseTotal(filters), cachedGenres()])
  const { page } = pageWindow(query.page, total, BROWSE_PAGE_SIZE)
  const result = await cachedBrowse({ ...filters, sort: query.sort, page, total })
  const items = await withLatest(result.items)
  const href = (page: number, sort = query.sort) =>
    browseHref({ page, sort }, `/genres/${genre.slug}`)
  const related = genres
    .filter((g) => g.kind === genre.kind && g.id !== genre.id && g.count > 0)
    .slice(0, 12)
  const faq = Array.isArray(genre.faq) ? genre.faq.filter((f) => f.q && f.a) : []
  const fallbackIntro = fmt(messages.discovery.genreIntroFallback, {
    genre: genre.name,
    site: messages.site.name,
    count: genre.count,
  })

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: messages.nav.home, item: siteUrl('/') },
          {
            '@type': 'ListItem',
            position: 2,
            name: messages.genres.title,
            item: siteUrl('/genres'),
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: genre.name,
            item: siteUrl(`/genres/${genre.slug}`),
          },
        ],
      },
      {
        '@type': 'ItemList',
        name: `${genre.name} · ${messages.site.name}`,
        itemListElement: items.slice(0, 10).map((s, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: siteUrl(s.href),
          name: s.title,
        })),
      },
      ...(faq.length > 0
        ? [
            {
              '@type': 'FAQPage',
              mainEntity: faq.map((f) => ({
                '@type': 'Question',
                name: f.q,
                acceptedAnswer: { '@type': 'Answer', text: f.a },
              })),
            },
          ]
        : []),
    ],
  }

  return (
    <div className="container-page flex flex-col gap-5 pt-5">
      <JsonLd data={jsonLd} />
      <nav
        aria-label={messages.discovery.breadcrumbs}
        className="flex items-center gap-1 text-[12px] font-semibold text-fg-subtle"
      >
        <Link href="/" className="hover:text-fg">
          {messages.nav.home}
        </Link>
        <ChevronRight size={12} aria-hidden="true" />
        <Link href="/genres" className="hover:text-fg">
          {messages.genres.title}
        </Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span className="text-fg-muted">{genre.name}</span>
      </nav>

      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-hover">
          {KIND_LABELS[genre.kind] ?? genre.kind}
        </p>
        <h1 className="section-title text-[26px] leading-8">{genre.name}</h1>
        <p className="text-[13px] font-semibold text-fg-muted">
          {fmt(messages.genres.count, { n: genre.count.toLocaleString('en') })}
        </p>
        {genre.intro ? (
          <RichText doc={genre.intro} className="max-w-[72ch]" />
        ) : (
          <p className="max-w-[72ch] text-[15px] leading-relaxed text-fg-muted">
            {truncateWords(fallbackIntro, 400)}
          </p>
        )}
      </header>

      <section aria-label={genre.name} className="flex flex-col gap-3">
        <nav
          aria-label={messages.browse.sort}
          className="flex flex-wrap gap-0.5 text-[12px] font-semibold"
        >
          {BROWSE_SORTS.map((s) => (
            <Link
              key={s}
              href={href(1, s)}
              aria-current={s === query.sort ? 'page' : undefined}
              className={cn(
                'rounded-md px-[9px] py-[3px] transition-colors duration-[120ms]',
                s === query.sort
                  ? 'bg-surface-2 text-fg'
                  : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              {SORT_LABELS[s]}
            </Link>
          ))}
          <Link
            href={browseHref({ genre: [genre.slug] })}
            className="ml-auto inline-flex items-center gap-1 text-[13px] text-brand-hover hover:text-fg"
          >
            {messages.browse.filters}
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </nav>
        {items.length === 0 ? (
          <EmptyState
            title={fmt(messages.discovery.genreEmpty, { genre: genre.name })}
            action={
              <Link href="/random" prefetch={false} className={buttonClasses('primary', 'sm')}>
                <Shuffle size={14} aria-hidden="true" />
                {messages.discovery.randomSeries}
              </Link>
            }
          />
        ) : (
          <SeriesGrid items={items} priorityCount={8} />
        )}
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          href={(n) => href(n)}
          className="mt-2"
        />
      </section>

      {faq.length > 0 ? (
        <section aria-labelledby="faq-title" className="flex max-w-[72ch] flex-col gap-2">
          <h2 id="faq-title" className="section-title text-[16px]">
            {messages.genres.faq}
          </h2>
          <dl className="flex flex-col gap-2">
            {faq.map((f) => (
              <div key={f.q} className="rounded-md border border-line bg-surface-1 p-3">
                <dt className="text-[14px] font-bold text-fg">{f.q}</dt>
                <dd className="mt-1 text-[14px] leading-relaxed text-fg-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {related.length > 0 ? (
        <section aria-labelledby="related-title" className="flex flex-col gap-2">
          <h2 id="related-title" className="section-title text-[16px]">
            {KIND_LABELS[genre.kind] ?? messages.genres.title}
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {related.map((g) => (
              <li key={g.id}>
                <Link
                  href={g.href}
                  className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-surface-2 px-2.5 text-[12px] font-bold text-fg-muted hover:bg-surface-3 hover:text-fg"
                >
                  {g.name}
                  <span className="text-[11px] tabular-nums text-fg-subtle">{g.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
