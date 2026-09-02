import { renderSeo, truncateWords } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import { AdSlot } from '@palscans/ui'
import { BookOpen } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { CommentsSection } from '@/components/comments/CommentsSection'
import { BookmarkButton, DownloadButton, RateButton } from '@/components/series/ActionIslands'
import { ChapterTable } from '@/components/series/ChapterTable'
import { NovelCard } from '@/components/series/NovelCard'
import { RecommendedGrid } from '@/components/series/RecommendedGrid'
import { SeriesCover } from '@/components/series/SeriesCover'
import { SeriesJsonLd } from '@/components/series/SeriesJsonLd'
import { AltTitles, Credits, GenreChips } from '@/components/series/SeriesMeta'
import { SeriesTitle } from '@/components/series/SeriesTitle'
import { StatTiles } from '@/components/series/StatTiles'
import { Synopsis } from '@/components/series/Synopsis'
import { storageUrl } from '@/lib/comments/media'
import { COMMENT_SORTS } from '@/lib/comments/types'
import { getAppUser } from '@/lib/comments/viewer'
import { entitlementGate } from '@/lib/entitlements'
import { getEnv } from '@/lib/env'
import { chapterRows, getSeries, loadRank, loadRecommended, viewerSeriesState } from './data'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const searchSchema = z.object({ sort: z.enum(COMMENT_SORTS).catch('best') })

const chapterHref = (slug: string, n: number) =>
  `/series/${slug}/chapter-${Number.parseFloat(n.toFixed(3))}`

/** docs/12 §2 — title/description templates with per-series overrides, canonical, OG/Twitter, robots. */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const series = await getSeries(slug)
  if (!series) return { title: messages.errors.notFound }
  const env = getEnv()
  const chapters = await chapterRows(series.id, null, new Date())
  const latest = chapters[0]
  const seo = renderSeo('series', {
    site: env.SITE_NAME,
    title: series.title,
    type: messages.series.type[series.type],
    chapter_count: series.chapterCount,
    latest_chapter: latest ? fmt(messages.series.chapterShort, { n: latest.number }) : '',
    genres: series.genres.map((g) => g.name).join(', '),
    author: series.people.find((p) => p.credit === 'author')?.name ?? '',
    year: series.releasedYear ?? '',
    synopsis: series.synopsis ?? '',
  })
  const title = series.seoTitle ?? seo.title
  const description = series.seoDescription ?? seo.description
  const canonical = series.canonicalUrl ?? `${env.SITE_URL}/series/${series.slug}`
  const ogKey = series.ogImageKey ?? series.coverKey
  const ogUrl = storageUrl(ogKey)
  const image = ogUrl ? (ogUrl.startsWith('http') ? ogUrl : `${env.SITE_URL}${ogUrl}`) : undefined
  return {
    title: { absolute: title },
    description: truncateWords(description, 300),
    alternates: { canonical },
    robots: series.noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: 'website',
      siteName: env.SITE_NAME,
      title,
      description,
      url: canonical,
      ...(image
        ? {
            images: [
              { url: image, alt: fmt(messages.seriesDetail.coverAlt, { title: series.title }) },
            ],
          }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}

/**
 * The series page — direction B (design/mockups/B/SeriesB.dc.html). Reads the session, so it
 * renders per request; the data helpers are split so the shell can move to PPR/ISR later.
 */
export default async function SeriesPage({ params, searchParams }: PageProps) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])
  const series = await getSeries(slug)
  if (!series) notFound()
  const { sort } = searchSchema.parse({ sort: typeof sp.sort === 'string' ? sp.sort : undefined })
  const env = getEnv()
  const now = new Date()
  const user = await getAppUser()
  const gate = await entitlementGate()
  const [chapters, rank, recommended, state] = await Promise.all([
    chapterRows(series.id, user, now, gate.overrides),
    loadRank(series.id),
    loadRecommended(series.id),
    viewerSeriesState(user, series.id),
  ])
  const noAds = !gate.showsAds(user, now)
  const coverUrl = storageUrl(series.coverKey)
  const coverAlt = fmt(messages.seriesDetail.coverAlt, { title: series.title })
  const first = chapters[chapters.length - 1]
  const latest = chapters[0]
  const continueChapter = state.progress && chapters.find((c) => c.id === state.progress?.chapterId)
  const author = series.people.find((p) => p.credit === 'author')?.name ?? null
  const primary =
    'inline-flex h-11 items-center gap-2 rounded-[12px] bg-brand px-5 text-[15px] font-bold text-brand-ink transition-colors hover:bg-brand-hover'
  const ghost =
    'inline-flex h-11 items-center gap-2 rounded-[12px] border border-line px-4 text-sm font-semibold text-fg transition-colors hover:border-brand hover:bg-brand-wash'

  return (
    <>
      <SeriesJsonLd
        series={series}
        siteUrl={env.SITE_URL}
        siteName={env.SITE_NAME}
        coverUrl={coverUrl}
        latestChapterNumber={latest?.number ?? null}
      />
      <div className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 left-10 h-[400px] w-[640px] bg-[radial-gradient(closest-side,var(--color-brand-wash),transparent)]"
        />
        <div className="container-page relative pt-6 md:pt-8">
          <nav
            aria-label="Breadcrumb"
            className="mx-auto mb-4 max-w-[1200px] text-[12px] text-fg-muted"
          >
            <ol className="flex items-center gap-1.5">
              <li>
                <a href="/" className="hover:text-fg">
                  {messages.seriesDetail.breadcrumbHome}
                </a>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <a href="/browse" className="hover:text-fg">
                  {messages.seriesDetail.breadcrumbSeries}
                </a>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="truncate text-fg">
                {series.title}
              </li>
            </ol>
          </nav>

          <div className="mx-auto flex max-w-[1200px] flex-col gap-5 lg:flex-row lg:items-start lg:gap-10">
            {/* Left column: cover, stats, genres, credits, alternative titles */}
            <aside className="contents lg:block lg:w-[320px] lg:shrink-0">
              <div className="order-1 flex gap-4 lg:block">
                <SeriesCover
                  src={coverUrl}
                  alt={coverAlt}
                  color={series.coverColor}
                  className="w-[124px] shrink-0 lg:w-full"
                />
                <StatTiles
                  ratingAvg={Number(series.ratingAvg ?? 0)}
                  ratingCount={series.ratingCount}
                  chapterCount={series.chapterCount}
                  bookmarkCount={series.bookmarkCount}
                  className="min-w-0 flex-1 lg:mt-4"
                />
              </div>
              <GenreChips genres={series.genres} className="order-5 lg:mt-5" />
              <Credits
                people={series.people}
                releasedYear={series.releasedYear}
                className="order-6 lg:mt-5"
              />
              <AltTitles titles={series.titles} className="order-7 lg:mt-4" />
            </aside>

            {/* Right column */}
            <section className="contents lg:block lg:min-w-0 lg:flex-1">
              <SeriesTitle
                className="order-2"
                title={series.title}
                type={series.type}
                status={series.status}
                releasedYear={series.releasedYear}
                rank={rank}
                lastChapterAt={series.lastChapterAt ? series.lastChapterAt.toISOString() : null}
              />

              <div className="order-3 flex flex-wrap items-center gap-2.5 lg:mt-[18px]">
                {continueChapter ? (
                  <>
                    <a href={chapterHref(series.slug, continueChapter.number)} className={primary}>
                      <BookOpen size={18} aria-hidden="true" />
                      {fmt(messages.series.continueChapter, {
                        chapter: fmt(messages.series.chapterShort, { n: continueChapter.number }),
                      })}
                    </a>
                    {first ? (
                      <a href={chapterHref(series.slug, first.number)} className={ghost}>
                        {messages.series.readFirst}
                      </a>
                    ) : null}
                  </>
                ) : first ? (
                  <a href={chapterHref(series.slug, first.number)} className={primary}>
                    <BookOpen size={18} aria-hidden="true" />
                    {messages.series.readFirst}
                  </a>
                ) : (
                  <span className={`${ghost} opacity-60`}>{messages.series.emptyChapters}</span>
                )}
                <BookmarkButton
                  seriesId={series.id}
                  seriesSlug={series.slug}
                  signedIn={!!user}
                  initial={state.bookmarkStatus !== null}
                />
                <RateButton
                  seriesId={series.id}
                  seriesSlug={series.slug}
                  signedIn={!!user}
                  initial={state.rating}
                />
                <DownloadButton entitled={gate.can('offline', user, now)} />
              </div>

              {series.synopsis ? (
                <Synopsis
                  text={series.synopsis}
                  title={series.title}
                  className="order-4 lg:mt-[18px]"
                />
              ) : null}

              <div className="order-8 lg:mt-[22px]">
                <AdSlot
                  slot="series_top"
                  width={728}
                  height={90}
                  label={messages.ads.leaderboard}
                  noAds={noAds}
                  className="hidden md:flex"
                />
                <AdSlot
                  slot="series_top"
                  width={320}
                  height={100}
                  label={messages.ads.leaderboard}
                  noAds={noAds}
                  className="md:hidden"
                />
              </div>

              <div className="order-9 lg:mt-[26px]">
                <ChapterTable
                  seriesSlug={series.slug}
                  chapters={chapters}
                  readIds={state.readIds}
                  continueId={state.progress?.chapterId ?? null}
                  now={now.toISOString()}
                  signedIn={!!user}
                />
              </div>

              <RecommendedGrid items={recommended} className="order-10 lg:mt-6" />

              <div className="order-11 flex flex-col gap-5 lg:mt-6 lg:flex-row lg:items-stretch">
                {series.linked && series.linked.type === 'novel' ? (
                  <NovelCard
                    title={series.linked.title}
                    slug={series.linked.slug}
                    author={author}
                    className="min-w-0 flex-1"
                  />
                ) : (
                  <div className="hidden min-w-0 flex-1 lg:block" />
                )}
                <AdSlot
                  slot="series_sidebar"
                  width={300}
                  height={250}
                  label={messages.ads.mpu}
                  noAds={noAds}
                  className="shrink-0 lg:mx-0"
                />
              </div>
            </section>
          </div>

          <div className="mx-auto mt-[18px] max-w-[1200px]">
            <CommentsSection
              target={{ kind: 'series', id: series.id }}
              user={user}
              sort={sort}
              enabled={series.commentsEnabled}
            />
          </div>
        </div>
      </div>
    </>
  )
}
