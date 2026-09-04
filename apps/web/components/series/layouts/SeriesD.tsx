import { fmt, messages } from '@palscans/core/messages'
import { AdSlot, cn, RelativeTime } from '@palscans/ui'
import { BookOpen } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CommentsSection } from '@/components/comments/CommentsSection'
import { StatusBadge, TypeBadge } from '@/components/discovery/Badges'
import { BookmarkButton, DownloadButton, RateButton } from '@/components/series/ActionIslands'
import { ChapterTable } from '@/components/series/ChapterTable'
import { NovelCard } from '@/components/series/NovelCard'
import { RecommendedGrid } from '@/components/series/RecommendedGrid'
import { SeriesCover } from '@/components/series/SeriesCover'
import { SeriesJsonLd } from '@/components/series/SeriesJsonLd'
import { GenreChips } from '@/components/series/SeriesMeta'
import { Synopsis } from '@/components/series/Synopsis'
import { chapterHref } from './chapter-href'
import type { SeriesViewProps } from './types'

const panel = 'rounded-lg border border-line bg-surface-1'
const panelHead =
  'flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3'
const panelTitle = 'm-0 font-display text-[16px] font-extrabold tracking-[-0.01em] text-fg'
const label =
  'text-[11px] font-bold uppercase tracking-[0.1em] text-fg-subtle [font-variant-caps:all-small-caps]'
const primary =
  'inline-flex h-11 items-center gap-2 rounded-[10px] bg-brand px-5 text-[15px] font-bold text-brand-ink transition-colors hover:bg-brand-hover'
const ghost =
  'inline-flex h-11 items-center gap-2 rounded-[10px] border border-line px-4 text-sm font-semibold text-fg transition-colors hover:border-brand hover:bg-brand-wash'

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b border-line-soft py-2 last:border-b-0">
      <dt className={label}>{name}</dt>
      <dd className="m-0 min-w-0 truncate text-[13px] font-semibold text-fg">{children}</dd>
    </div>
  )
}

/**
 * Series layout **D · Catalog Grid** (design/mockups/D/SeriesD.dc.html): a data-sheet header,
 * every fact in one panel, then the chapter table, recommendations and the same ad slots and
 * comments island every direction carries. Presentational — `loadSeriesView()` loads.
 */
export function SeriesD({
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
  const artist = series.people.find((p) => p.credit === 'artist')?.name ?? null
  const ratingAvg = Number(series.ratingAvg ?? 0)
  const altTitles = series.titles.map((t) => t.title).join(' · ')

  return (
    <>
      <SeriesJsonLd
        series={series}
        siteUrl={site.url}
        siteName={site.name}
        coverUrl={coverUrl}
        latestChapterNumber={latest?.number ?? null}
      />
      <div className="container-page flex flex-col gap-5 py-5 pb-10">
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

        <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex gap-4 lg:block">
              <SeriesCover
                src={coverUrl}
                alt={coverAlt}
                color={series.coverColor}
                className="w-[124px] shrink-0 lg:w-full"
              />
              <div className="flex min-w-0 flex-1 flex-wrap content-start gap-1.5 lg:hidden">
                <TypeBadge type={series.type} />
                <StatusBadge status={series.status} />
              </div>
            </div>
            <section aria-labelledby="details-title" className={panel}>
              <div className={panelHead}>
                <h2 id="details-title" className={panelTitle}>
                  {messages.layouts.detailsTitle}
                </h2>
              </div>
              <dl className="m-0 grid grid-cols-2 gap-x-4 px-4 py-1 lg:grid-cols-1">
                <Field name={messages.browse.type}>{messages.series.type[series.type]}</Field>
                <Field name={messages.browse.status}>{messages.series.status[series.status]}</Field>
                {series.releasedYear ? (
                  <Field name={messages.browse.year}>{series.releasedYear}</Field>
                ) : null}
                {author ? <Field name={messages.series.author}>{author}</Field> : null}
                {artist ? <Field name={messages.series.artist}>{artist}</Field> : null}
                <Field name={messages.layouts.rank}>{rank ? `#${rank}` : '—'}</Field>
                <Field name={messages.layouts.rating}>
                  {series.ratingCount > 0
                    ? `${ratingAvg.toFixed(1)} · ${fmt(messages.series.ratings, { n: series.ratingCount.toLocaleString('en') })}`
                    : '—'}
                </Field>
                <Field name={messages.layouts.bookmarks}>
                  {series.bookmarkCount.toLocaleString('en')}
                </Field>
                <Field name={messages.series.chapters}>{series.chapterCount}</Field>
                {altTitles ? <Field name={messages.layouts.altTitles}>{altTitles}</Field> : null}
              </dl>
            </section>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <TypeBadge type={series.type} />
                <StatusBadge status={series.status} />
                {rank ? (
                  <span className="inline-flex h-[18px] items-center rounded-sm border border-line px-2 text-[11px] font-bold text-fg-muted">
                    {fmt(messages.series.rank, { n: rank })}
                  </span>
                ) : null}
                {latest?.publishedAt ? (
                  <span className="inline-flex h-[18px] items-center gap-1.5 text-[11px] font-semibold text-fg-subtle">
                    {fmt(messages.series.chapterShort, { n: latest.number })}
                    <RelativeTime iso={latest.publishedAt} className="tabular-nums" />
                  </span>
                ) : null}
              </div>
              <h1 className="m-0 break-words font-display text-[clamp(28px,4vw,40px)] font-extrabold leading-[1.05] tracking-[-0.02em] text-fg">
                {series.title}
              </h1>
              <GenreChips genres={series.genres} />
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {continueChapter ? (
                  <>
                    <Link
                      href={chapterHref(series.slug, continueChapter.number)}
                      className={primary}
                    >
                      <BookOpen size={18} aria-hidden="true" />
                      {fmt(messages.series.continueChapter, {
                        chapter: fmt(messages.series.chapterShort, { n: continueChapter.number }),
                      })}
                    </Link>
                    {first ? (
                      <Link href={chapterHref(series.slug, first.number)} className={ghost}>
                        {messages.series.readFirst}
                      </Link>
                    ) : null}
                  </>
                ) : first ? (
                  <Link href={chapterHref(series.slug, first.number)} className={primary}>
                    <BookOpen size={18} aria-hidden="true" />
                    {messages.series.readFirst}
                  </Link>
                ) : (
                  <span className={cn(ghost, 'opacity-60')}>{messages.series.emptyChapters}</span>
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
                <DownloadButton entitled={canDownload} />
              </div>
            </div>

            <div>
              {ads.top.show ? (
                <>
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
                </>
              ) : null}
            </div>

            {series.synopsis ? (
              <section aria-labelledby="synopsis-title" className={panel}>
                <div className={panelHead}>
                  <h2 id="synopsis-title" className={panelTitle}>
                    {messages.series.synopsis}
                  </h2>
                </div>
                <div className="px-4 py-3">
                  <Synopsis text={series.synopsis} title={series.title} />
                </div>
              </section>
            ) : null}

            <section aria-labelledby="chapters-title" className={panel}>
              <div className={panelHead}>
                <h2 id="chapters-title" className={panelTitle}>
                  {messages.series.chapters}
                </h2>
                <span className="text-[12px] tabular-nums text-fg-subtle">
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
