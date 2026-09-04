import { fmt, messages } from '@palscans/core/messages'
import { AdSlot, cn, Rail, RelativeTime } from '@palscans/ui'
import { Check, ChevronRight, Lock, Play } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CommentsSection } from '@/components/comments/CommentsSection'
import { StatusBadge, TypeBadge } from '@/components/discovery/Badges'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import { BookmarkButton, DownloadButton, RateButton } from '@/components/series/ActionIslands'
import { ChapterTable } from '@/components/series/ChapterTable'
import { NovelCard } from '@/components/series/NovelCard'
import { RecommendedGrid } from '@/components/series/RecommendedGrid'
import { SeriesJsonLd } from '@/components/series/SeriesJsonLd'
import { AltTitles, GenreChips } from '@/components/series/SeriesMeta'
import { Synopsis } from '@/components/series/Synopsis'
import { chapterHref } from './chapter-href'
import type { SeriesViewProps } from './types'

/** The mockup's frosted chrome, expressed with `fg` alpha so it inverts with the theme. */
const glass = 'border border-fg/12 bg-fg/6 backdrop-blur-md'
const railTitle =
  'm-0 font-display text-[20px] font-extrabold leading-tight tracking-[-0.01em] text-fg sm:text-[22px]'

function Stat({ name, value }: { name: string; value: ReactNode }) {
  return (
    <div className={cn(glass, 'flex min-w-0 flex-col gap-0.5 rounded-lg px-3.5 py-2.5')}>
      <span className="truncate text-[19px] font-semibold leading-6 text-fg">{value}</span>
      <span className="truncate text-[12px] text-fg-muted">{name}</span>
    </div>
  )
}

/**
 * Series layout **F · Cinematic Rows** (design/mockups/F/SeriesF.dc.html): the cover blurred
 * into a full-bleed backdrop, a frosted title panel lifted over it, an episodes rail and then
 * the chapter table beside the synopsis — with the same ad slots and comments island every
 * direction carries. Presentational — `loadSeriesView()` does the loading.
 */
export function SeriesF({
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
  const episodes = chapters.slice(0, 12)

  return (
    <>
      <SeriesJsonLd
        series={series}
        siteUrl={site.url}
        siteName={site.name}
        coverUrl={coverUrl}
        latestChapterNumber={latest?.number ?? null}
      />
      <div className="flex flex-col gap-7 pb-10">
        <div className="relative isolate">
          {coverUrl ? (
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden"
            >
              <img
                src={coverUrl}
                alt=""
                width={COVER_WIDTH}
                height={COVER_HEIGHT}
                decoding="async"
                className="h-full w-full scale-125 object-cover opacity-60 blur-2xl saturate-150"
              />
              <div className="absolute inset-0 bg-linear-to-t from-bg via-bg/60 via-45% to-bg/20" />
            </div>
          ) : null}

          <section
            aria-labelledby="series-title"
            className="container-page flex flex-col gap-5 pt-6 lg:flex-row lg:items-start lg:gap-7 lg:pt-[180px]"
          >
            <img
              src={coverUrl ?? ''}
              alt={coverAlt}
              width={COVER_WIDTH}
              height={COVER_HEIGHT}
              decoding="async"
              className={cn(
                'block w-[150px] shrink-0 rounded-lg border border-fg/12 object-cover shadow-2 sm:w-[190px] lg:w-[240px]',
                !coverUrl && 'hidden',
              )}
            />

            <div
              className={cn(glass, 'flex min-w-0 flex-1 flex-col gap-3.5 rounded-lg p-5 sm:p-7')}
            >
              <div className="flex min-w-0 flex-col gap-1">
                <h1
                  id="series-title"
                  className="m-0 break-words font-display text-[clamp(28px,4.4vw,44px)] font-extrabold leading-[1.05] tracking-[-0.02em] text-fg"
                >
                  {series.title}
                </h1>
                <AltTitles titles={series.titles} />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <TypeBadge type={series.type} />
                <StatusBadge status={series.status} />
                {rank ? (
                  <span className="inline-flex h-[18px] items-center rounded-full bg-gold/15 px-2 text-[11px] font-bold text-gold">
                    {fmt(messages.series.rank, { n: rank })}
                  </span>
                ) : null}
              </div>

              <div className="grid max-w-[640px] grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat
                  name={messages.layouts.rating}
                  value={
                    series.ratingCount > 0 ? (
                      <span className="text-gold">{ratingAvg.toFixed(1)}</span>
                    ) : (
                      '—'
                    )
                  }
                />
                <Stat name={messages.series.chapters} value={series.chapterCount} />
                <Stat
                  name={messages.layouts.bookmarks}
                  value={series.bookmarkCount.toLocaleString('en')}
                />
              </div>

              <GenreChips genres={series.genres} />

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {continueChapter ? (
                  <>
                    <Link
                      href={chapterHref(series.slug, continueChapter.number)}
                      className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 text-[15px] font-bold text-brand-ink transition-colors hover:bg-brand-hover"
                    >
                      <Play size={18} aria-hidden="true" />
                      {fmt(messages.series.continueChapter, {
                        chapter: fmt(messages.series.chapterShort, { n: continueChapter.number }),
                      })}
                    </Link>
                    {first ? (
                      <Link
                        href={chapterHref(series.slug, first.number)}
                        className={cn(
                          glass,
                          'inline-flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-fg transition-colors hover:bg-fg/12',
                        )}
                      >
                        {messages.series.readFirst}
                      </Link>
                    ) : null}
                  </>
                ) : first ? (
                  <Link
                    href={chapterHref(series.slug, first.number)}
                    className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 text-[15px] font-bold text-brand-ink transition-colors hover:bg-brand-hover"
                  >
                    <Play size={18} aria-hidden="true" />
                    {messages.series.readFirst}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      glass,
                      'inline-flex h-12 items-center rounded-full px-5 text-[15px] font-semibold text-fg-muted',
                    )}
                  >
                    {messages.series.emptyChapters}
                  </span>
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
            </div>
          </section>
        </div>

        {ads.top.show ? (
          <div className="container-page">
            <AdSlot
              slot="series_top"
              width={728}
              height={90}
              label={messages.ads.leaderboard}
              placeholder={ads.top.placeholder}
              className="hidden md:flex"
            />
            <AdSlot
              slot="series_top"
              width={320}
              height={100}
              label={messages.ads.leaderboard}
              placeholder={ads.top.placeholder}
              className="md:hidden"
            />
          </div>
        ) : null}

        {episodes.length > 0 ? (
          <section aria-labelledby="episodes-title" className="container-page flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="episodes-title" className={railTitle}>
                {messages.layouts.episodes}
              </h2>
              <a
                href="#chapters-title"
                className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-brand-hover hover:text-fg"
              >
                {messages.layouts.seeAll}
                <ChevronRight size={15} aria-hidden="true" />
              </a>
            </div>
            <Rail label={messages.layouts.episodes} itemWidth="200px">
              {episodes.map((c, i) => (
                <Link
                  key={c.id}
                  href={chapterHref(series.slug, c.number)}
                  className={cn(
                    glass,
                    'flex h-[120px] flex-col justify-between rounded-lg p-4 transition-colors hover:bg-fg/12',
                    i === 0 && 'bg-brand-wash',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-display text-[18px] font-extrabold leading-[22px] tracking-[-0.01em] text-fg">
                      {fmt(messages.series.chapterShort, { n: c.number })}
                    </span>
                    {!c.canRead ? (
                      <Lock
                        size={15}
                        className="shrink-0 text-gold"
                        aria-label={messages.series.locked}
                      />
                    ) : state.readIds.includes(c.id) ? (
                      <Check size={15} className="shrink-0 text-fg-subtle" aria-hidden="true" />
                    ) : null}
                  </span>
                  {c.publishedAt ? (
                    <RelativeTime
                      iso={c.publishedAt}
                      className="truncate text-[13px] tabular-nums text-fg-muted"
                    />
                  ) : null}
                </Link>
              ))}
            </Rail>
          </section>
        ) : null}

        <div className="container-page grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section
            aria-labelledby="chapters-title"
            className={cn(glass, 'min-w-0 overflow-hidden rounded-lg')}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-fg/12 px-4 py-3">
              <h2
                id="chapters-title"
                className="m-0 font-display text-[17px] font-extrabold tracking-[-0.01em] text-fg"
              >
                {messages.series.chapters}
              </h2>
              <span className="text-[13px] tabular-nums text-fg-muted">
                {fmt(messages.series.chapterCount, { n: series.chapterCount })}
              </span>
            </div>
            <div className="px-4 py-3">
              <ChapterTable
                seriesSlug={series.slug}
                chapters={chapters}
                readIds={state.readIds}
                continueId={state.progress?.chapterId ?? null}
                now={now.toISOString()}
                signedIn={!!user}
                earlyAccessMinutes={earlyAccessMinutes}
              />
            </div>
          </section>

          <aside className="flex min-w-0 flex-col gap-4">
            {series.synopsis ? (
              <section
                aria-labelledby="synopsis-title"
                className={cn(glass, 'min-w-0 rounded-lg px-4 py-3.5')}
              >
                <h2
                  id="synopsis-title"
                  className="m-0 mb-1.5 font-display text-[17px] font-extrabold tracking-[-0.01em] text-fg"
                >
                  {messages.series.synopsis}
                </h2>
                <Synopsis text={series.synopsis} title={series.title} />
              </section>
            ) : null}

            {series.linked && series.linked.type === 'novel' ? (
              <NovelCard
                title={series.linked.title}
                slug={series.linked.slug}
                author={author}
                className="min-w-0"
              />
            ) : null}

            {ads.mpu.show ? (
              <AdSlot
                slot="series_sidebar"
                width={300}
                height={250}
                label={messages.ads.mpu}
                placeholder={ads.mpu.placeholder}
              />
            ) : null}

            <RecommendedGrid items={recommended} className="min-w-0" />
          </aside>
        </div>

        <div className="container-page">
          <CommentsSection
            target={{ kind: 'series', id: series.id }}
            user={user}
            sort={sort}
            enabled={series.commentsEnabled}
          />
        </div>
      </div>
    </>
  )
}
