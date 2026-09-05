import { formatChapterLabel } from '@palscans/core/formatting'
import { fmt, messages } from '@palscans/core/messages'
import { AdSlot, cn, RelativeTime } from '@palscans/ui'
import { BookOpen } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CommentsSection } from '@/components/comments/CommentsSection'
import { StatusBadge, TypeBadge } from '@/components/discovery/Badges'
import { BookmarkButton, DownloadButton, RateButton } from '@/components/series/ActionIslands'
import { ChapterTable } from '@/components/series/ChapterTable'
import { FollowControl } from '@/components/series/FollowControl'
import { NovelCard } from '@/components/series/NovelCard'
import { RecommendedGrid } from '@/components/series/RecommendedGrid'
import { SeriesCover } from '@/components/series/SeriesCover'
import { SeriesJsonLd } from '@/components/series/SeriesJsonLd'
import { AltTitles, Credits, GenreChips } from '@/components/series/SeriesMeta'
import { Synopsis } from '@/components/series/Synopsis'
import { chapterHref } from './chapter-href'
import type { SeriesViewProps } from './types'

/**
 * Daylight's surfaces, in tokens only — the direction reads as white cards on lilac under
 * the light theme and as raised dark cards under the dark one.
 */
const card = 'rounded-lg border border-line bg-surface-1 shadow-2'
const primary =
  'inline-flex h-[42px] items-center gap-2 rounded-full bg-brand px-5 text-[14px] font-bold text-brand-ink transition-colors hover:bg-brand-hover'
const outline =
  'inline-flex h-[42px] items-center gap-2 rounded-full border-[1.5px] border-brand px-4 text-[14px] font-bold text-brand-hover transition-colors hover:bg-brand-wash'
const statLabel = 'text-[11px] font-bold uppercase tracking-[0.06em]'

/** One of the three tinted stat tiles under the title. */
function Stat({
  name,
  value,
  hint,
  tone,
}: {
  name: string
  value: ReactNode
  hint?: ReactNode
  tone: 'gold' | 'brand' | 'quiet'
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-0.5 rounded-lg px-4 py-3',
        tone === 'gold' && 'bg-gold/12',
        tone === 'brand' && 'bg-brand-wash',
        tone === 'quiet' && 'bg-surface-2',
      )}
    >
      <span
        className={cn(
          statLabel,
          tone === 'gold' && 'text-gold',
          tone === 'brand' && 'text-brand-hover',
          tone === 'quiet' && 'text-fg-muted',
        )}
      >
        {name}
      </span>
      <span className="truncate font-display text-[22px] font-extrabold leading-tight tracking-[-0.01em] text-fg">
        {value}
      </span>
      {hint ? (
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-fg-muted">
          {hint}
        </span>
      ) : null}
    </div>
  )
}

function Panel({
  title,
  id,
  children,
  aside,
}: {
  title: string
  id: string
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section aria-labelledby={id} className={cn(card, 'min-w-0 overflow-hidden')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2
          id={id}
          className="m-0 font-display text-[17px] font-extrabold tracking-[-0.01em] text-fg"
        >
          {title}
        </h2>
        {aside}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

/**
 * Series layout **E · Daylight** (design/mockups/E/SeriesE.dc.html): a card-framed cover
 * beside tinted stat tiles on a lilac band, then the chapter panel with synopsis, the novel
 * cross-sell, the MPU and recommendations in the right column — plus the same ad slots and
 * comments island every direction carries. Presentational — `loadSeriesView()` loads.
 */
export function SeriesE({
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
  formatting,
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
      <div className="flex flex-col gap-6 pb-10">
        <section
          aria-labelledby="series-title"
          className="bg-linear-to-b from-brand-wash to-bg pb-6 pt-4"
        >
          <div className="container-page flex flex-col gap-4">
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

            <div className="grid items-start gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
              <div className={cn(card, 'w-[140px] shrink-0 p-2.5 sm:w-[180px] lg:w-full')}>
                <SeriesCover
                  src={coverUrl}
                  alt={coverAlt}
                  color={series.coverColor}
                  className="w-full"
                />
              </div>

              <div className="flex min-w-0 flex-col gap-3.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <TypeBadge type={series.type} />
                  <StatusBadge status={series.status} />
                </div>

                <h1
                  id="series-title"
                  className="m-0 break-words font-display text-[clamp(28px,4vw,40px)] font-extrabold leading-[1.1] tracking-[-0.01em] text-fg"
                >
                  {series.title}
                </h1>

                <div className="grid max-w-[620px] grid-cols-1 gap-3 sm:grid-cols-3">
                  <Stat
                    tone="gold"
                    name={messages.layouts.rating}
                    value={series.ratingCount > 0 ? ratingAvg.toFixed(1) : '—'}
                    hint={
                      series.ratingCount > 0
                        ? fmt(messages.series.ratings, {
                            n: series.ratingCount.toLocaleString('en'),
                          })
                        : null
                    }
                  />
                  <Stat
                    tone="brand"
                    name={messages.series.chapters}
                    value={series.chapterCount}
                    hint={
                      latest ? (
                        <>
                          <span className="shrink-0">
                            {formatChapterLabel(latest.number, formatting.chapterLabel)}
                          </span>
                          {latest.publishedAt ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <RelativeTime
                                iso={latest.publishedAt}
                                className="truncate tabular-nums"
                              />
                            </>
                          ) : null}
                        </>
                      ) : null
                    }
                  />
                  <Stat
                    tone="quiet"
                    name={messages.layouts.bookmarks}
                    value={series.bookmarkCount.toLocaleString('en')}
                    hint={rank ? fmt(messages.series.rank, { n: rank }) : null}
                  />
                </div>

                <Credits
                  people={series.people}
                  releasedYear={series.releasedYear}
                  className="max-w-[620px]"
                />
                <GenreChips genres={series.genres} />

                <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                  {continueChapter ? (
                    <>
                      <Link
                        href={chapterHref(series.slug, continueChapter.number)}
                        className={primary}
                      >
                        <BookOpen size={17} aria-hidden="true" />
                        {fmt(messages.series.continueChapter, {
                          chapter: formatChapterLabel(
                            continueChapter.number,
                            formatting.chapterLabel,
                          ),
                        })}
                      </Link>
                      {first ? (
                        <Link href={chapterHref(series.slug, first.number)} className={outline}>
                          {messages.series.readFirst}
                        </Link>
                      ) : null}
                    </>
                  ) : first ? (
                    <Link href={chapterHref(series.slug, first.number)} className={primary}>
                      <BookOpen size={17} aria-hidden="true" />
                      {messages.series.readFirst}
                    </Link>
                  ) : (
                    <span className={cn(outline, 'opacity-60')}>
                      {messages.series.emptyChapters}
                    </span>
                  )}
                  <BookmarkButton
                    seriesId={series.id}
                    seriesSlug={series.slug}
                    signedIn={!!user}
                    initial={state.bookmarkStatus !== null}
                  />
                  {/* A follow is not the bookmark above it: the shelf stays a shelf, this decides
                      whether and how the next chapter reaches the reader (docs/17 §D). */}
                  <FollowControl seriesId={series.id} seriesSlug={series.slug} />
                  <RateButton
                    seriesId={series.id}
                    seriesSlug={series.slug}
                    signedIn={!!user}
                    initial={state.rating}
                  />
                  <DownloadButton entitled={canDownload} chapters={chapters} />
                </div>

                <AltTitles titles={series.titles} />
              </div>
            </div>
          </div>
        </section>

        {ads.top.show ? (
          <div className="container-page">
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
          </div>
        ) : null}

        <div className="container-page grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Panel
            id="chapters-title"
            title={messages.series.chapters}
            aside={
              <span className="text-[13px] tabular-nums text-fg-muted">
                {fmt(messages.series.chapterCount, { n: series.chapterCount })}
              </span>
            }
          >
            <ChapterTable
              seriesSlug={series.slug}
              chapters={chapters}
              readIds={state.readIds}
              continueId={state.progress?.chapterId ?? null}
              now={now.toISOString()}
              signedIn={!!user}
              earlyAccessMinutes={earlyAccessMinutes}
            />
          </Panel>

          <aside className="flex min-w-0 flex-col gap-4">
            {series.synopsis ? (
              <Panel id="synopsis-title" title={messages.series.synopsis}>
                <Synopsis text={series.synopsis} title={series.title} />
              </Panel>
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
                tag={ads.mpu.tag}
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
