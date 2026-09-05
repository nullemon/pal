import { fmt, messages } from '@palscans/core/messages'
import { AdSlot, cn, RelativeTime } from '@palscans/ui'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { CommentsSection } from '@/components/comments/CommentsSection'
import { BookmarkButton, DownloadButton, RateButton } from '@/components/series/ActionIslands'
import { ChapterTable } from '@/components/series/ChapterTable'
import { NovelCard } from '@/components/series/NovelCard'
import { RecommendedGrid } from '@/components/series/RecommendedGrid'
import { SeriesCover } from '@/components/series/SeriesCover'
import { SeriesJsonLd } from '@/components/series/SeriesJsonLd'
import { AltTitles, Credits, GenreChips } from '@/components/series/SeriesMeta'
import { Synopsis } from '@/components/series/Synopsis'
import { chapterHref } from './chapter-href'
import type { SeriesViewProps } from './types'

const rule = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted'
const paperBtn =
  'inline-flex h-11 items-center gap-2.5 rounded-sm bg-fg px-5 text-[14px] font-bold text-bg transition-opacity hover:opacity-90'
const ghostBtn =
  'inline-flex h-11 items-center gap-2 rounded-sm border border-line px-4 text-[13px] font-semibold text-fg transition-colors hover:border-fg-subtle'

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'gold' }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-l border-line pl-3 first:border-l-0 first:pl-0">
      <span className={rule}>{label}</span>
      <span
        className={cn(
          'truncate font-display text-[22px] font-extrabold leading-none tracking-[-0.02em]',
          tone === 'gold' ? 'text-gold' : 'text-fg',
        )}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Series layout **C · Editorial Noir** (design/mockups/C/SeriesC.dc.html): a masthead title
 * over a details rail, hairline rules instead of cards, and the same chapter table, ad
 * slots and comments island every direction carries. Presentational — `loadSeriesView()`
 * does the loading.
 */
export function SeriesC({
  series,
  user,
  now,
  sort,
  chapters,
  rank,
  recommended,
  state,
  coverUrl,
  coverAlt,
  canDownload,
  earlyAccessMinutes,
  site,
  ads,
}: SeriesViewProps) {
  const first = chapters[chapters.length - 1]
  const latest = chapters[0]
  const continueChapter = state.progress && chapters.find((c) => c.id === state.progress?.chapterId)
  const author = series.people.find((p) => p.credit === 'author')?.name ?? null
  const ratingAvg = Number(series.ratingAvg ?? 0)

  return (
    <>
      <SeriesJsonLd
        series={series}
        siteUrl={site.url}
        siteName={site.name}
        coverUrl={coverUrl}
        latestChapterNumber={latest?.number ?? null}
      />
      <div className="container-page flex flex-col gap-8 pb-10 pt-5">
        <nav aria-label="Breadcrumb" className="text-[12px] text-fg-muted">
          <ol className="flex list-none flex-wrap items-center gap-1.5 p-0">
            <li>
              <Link href="/" className="hover:text-fg">
                {messages.seriesDetail.breadcrumbHome}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/browse" className="hover:text-fg">
                {messages.seriesDetail.breadcrumbSeries}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="min-w-0 truncate text-fg">
              {series.title}
            </li>
          </ol>
        </nav>

        <div className="grid items-start gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-12">
          <aside className="flex min-w-0 flex-col gap-5">
            <div className="flex gap-4 lg:block">
              <SeriesCover
                src={coverUrl}
                alt={coverAlt}
                color={series.coverColor}
                className="w-[124px] shrink-0 lg:w-full"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-3 lg:hidden">
                <span className={rule}>{messages.series.type[series.type]}</span>
                <span className={rule}>{messages.series.status[series.status]}</span>
              </div>
            </div>
            <div className="hidden gap-x-6 gap-y-3 lg:grid lg:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1">
                <span className={rule}>{messages.browse.type}</span>
                <span className="truncate text-[13px] font-semibold text-fg">
                  {messages.series.type[series.type]}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className={rule}>{messages.browse.status}</span>
                <span className="truncate text-[13px] font-semibold text-fg">
                  {messages.series.status[series.status]}
                </span>
              </div>
            </div>
            <Credits people={series.people} releasedYear={series.releasedYear} />
            <GenreChips genres={series.genres} />
            <AltTitles titles={series.titles} />
          </aside>

          <div className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-col gap-4 border-b border-line pb-6">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="block h-px w-7 bg-gold" />
                <span className={rule}>{messages.series.type[series.type]}</span>
                <span aria-hidden="true" className="text-fg-subtle">
                  ·
                </span>
                <span className={rule}>{messages.series.status[series.status]}</span>
              </div>
              <h1 className="m-0 break-words font-display text-[clamp(34px,6vw,68px)] font-extrabold leading-[0.96] tracking-[-0.035em] text-fg">
                {series.title}
              </h1>
              <div className="flex flex-wrap gap-x-6 gap-y-4">
                <Stat label={messages.layouts.rank} value={rank ? `#${rank}` : '—'} />
                <Stat
                  label={messages.layouts.rating}
                  value={series.ratingCount > 0 ? ratingAvg.toFixed(1) : '—'}
                  tone="gold"
                />
                <Stat
                  label={messages.layouts.bookmarks}
                  value={series.bookmarkCount.toLocaleString('en')}
                />
                <Stat label={messages.series.chapters} value={String(series.chapterCount)} />
              </div>
              {series.lastChapterAt ? (
                <p className={cn(rule, 'm-0')}>
                  {fmt(messages.layouts.chapterMeta, {
                    n: series.chapterCount,
                    chapter: latest
                      ? fmt(messages.series.chapterShort, { n: latest.number })
                      : messages.series.emptyChapters,
                  })}{' '}
                  <RelativeTime
                    iso={series.lastChapterAt.toISOString()}
                    className="tabular-nums text-fg-subtle"
                  />
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {continueChapter ? (
                <>
                  <Link
                    href={chapterHref(series.slug, continueChapter.number)}
                    className={paperBtn}
                  >
                    {fmt(messages.series.continueChapter, {
                      chapter: fmt(messages.series.chapterShort, { n: continueChapter.number }),
                    })}
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                  {first ? (
                    <Link href={chapterHref(series.slug, first.number)} className={ghostBtn}>
                      {messages.series.readFirst}
                    </Link>
                  ) : null}
                </>
              ) : first ? (
                <Link href={chapterHref(series.slug, first.number)} className={paperBtn}>
                  {messages.series.readFirst}
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              ) : (
                <span className={cn(ghostBtn, 'opacity-60')}>{messages.series.emptyChapters}</span>
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
              <DownloadButton entitled={canDownload} chapters={chapters} />
            </div>

            {series.synopsis ? <Synopsis text={series.synopsis} title={series.title} /> : null}

            <div>
              {ads.top.show ? (
                <AdSlot
                  slot="series_top"
                  width={320}
                  height={100}
                  desktopWidth={728}
                  desktopHeight={90}
                  label={messages.ads.leaderboard}
                  placeholder={ads.top.placeholder}
                  tag={ads.top.tag}
                />
              ) : null}
            </div>

            <section aria-labelledby="chapters-title" className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
                <h2
                  id="chapters-title"
                  className="m-0 font-display text-[24px] font-extrabold tracking-[-0.02em] text-fg"
                >
                  {messages.series.chapters}
                </h2>
                <span className={rule}>
                  {fmt(messages.series.chapterCount, { n: series.chapterCount })}
                </span>
              </div>
              <ChapterTable
                seriesSlug={series.slug}
                chapters={chapters}
                readIds={state.readIds}
                continueId={state.progress?.chapterId ?? null}
                now={now.toISOString()}
                signedIn={!!user}
                earlyAccessMinutes={earlyAccessMinutes}
              />
            </section>

            <RecommendedGrid items={recommended} />

            <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
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
              {ads.mpu.show ? (
                <AdSlot
                  slot="series_sidebar"
                  width={300}
                  height={250}
                  label={messages.ads.mpu}
                  placeholder={ads.mpu.placeholder}
                  tag={ads.mpu.tag}
                  className="shrink-0 lg:mx-0"
                />
              ) : null}
            </div>
          </div>
        </div>

        <CommentsSection
          target={{ kind: 'series', id: series.id }}
          user={user}
          sort={sort}
          enabled={series.commentsEnabled}
        />
      </div>
    </>
  )
}
