import { fmt, messages } from '@palscans/core/messages'
import { AdSlot, cn, RelativeTime } from '@palscans/ui'
import { Bookmark, BookOpen, List, Lock, Play, Star, Trophy } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CommentsSection } from '@/components/comments/CommentsSection'
import { StatusBadge, TypeBadge } from '@/components/discovery/Badges'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
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

const primary =
  'inline-flex h-11 items-center gap-2 rounded-[10px] bg-brand px-5 text-sm font-extrabold text-brand-ink shadow-2 transition-colors hover:bg-brand-hover'
const ghost =
  'inline-flex h-11 items-center gap-2 rounded-[10px] border border-line bg-surface-1 px-4 text-sm font-semibold text-fg transition-colors hover:border-brand hover:bg-brand-wash'

/** One cell of the header's stat strip; the rank cell wears the brand wash of the mockup. */
function Stat({
  name,
  value,
  icon,
  tone,
}: {
  name: string
  value: string
  icon: ReactNode
  tone?: 'brand'
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 basis-[136px] flex-col justify-center gap-0.5 rounded-[10px] border px-3.5 py-2.5',
        tone === 'brand'
          ? 'border-brand/50 bg-linear-to-br from-brand/30 to-brand/10'
          : 'border-line bg-surface-1',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 font-display text-[22px] font-extrabold leading-6 tracking-[-0.03em] text-fg">
        {icon}
        <span className="truncate tabular-nums">{value}</span>
      </span>
      <span className="truncate text-[13px] leading-4 text-fg-muted">{name}</span>
    </div>
  )
}

/**
 * Series layout **A · Violet Classic** (design/mockups/A/SeriesA.dc.html): the cover blown up
 * into a cinematic banner with the breadcrumb over it, a header block lifted onto that banner,
 * then the synopsis, chapter table and novel cross-sell beside the mockup's right rail — the
 * newest chapters over the MPU — with the recommendations, the same ad slots, JSON-LD and
 * comments island every direction carries. Presentational: `loadSeriesView()` does the loading.
 */
export function SeriesA({
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
  const latestTen = chapters.slice(0, 10)

  return (
    <>
      <SeriesJsonLd
        series={series}
        siteUrl={site.url}
        siteName={site.name}
        coverUrl={coverUrl}
        latestChapterNumber={latest?.number ?? null}
      />
      <div className="flex flex-col pb-10">
        {/* Cinematic banner — the cover, blurred and darkened, clipped so nothing widens the page. */}
        <div className="relative h-[168px] overflow-hidden bg-surface-1 sm:h-[240px] lg:h-[380px]">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              aria-hidden="true"
              width={COVER_WIDTH}
              height={COVER_HEIGHT}
              decoding="async"
              className="absolute inset-0 size-full scale-110 object-cover opacity-70 blur-2xl saturate-125"
            />
          ) : null}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-linear-to-b from-bg/20 via-bg/60 via-50% to-bg"
          />
          <nav aria-label="Breadcrumb" className="container-page relative pt-4 text-[12px]">
            <ol className="flex list-none flex-wrap items-center gap-1.5 p-0 font-semibold text-fg-muted">
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
        </div>

        {/* Header block — lifted onto the banner from lg up, plain stacked flow below it. */}
        <section
          aria-labelledby="series-title"
          className="container-page relative z-10 mt-5 lg:-mt-[150px]"
        >
          <div className="grid grid-cols-[132px_minmax(0,1fr)] items-start gap-x-4 gap-y-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-x-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-x-8">
            <div className="min-w-0 lg:row-span-2">
              <SeriesCover
                src={coverUrl}
                alt={coverAlt}
                color={series.coverColor}
                className="w-full"
              />
            </div>

            <div className="flex min-w-0 flex-col gap-2.5 lg:pt-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <TypeBadge type={series.type} />
                <StatusBadge status={series.status} />
                {series.releasedYear ? (
                  <span className="inline-flex h-[18px] shrink-0 items-center rounded-sm border border-line bg-surface-2 px-1.5 text-[10px] font-extrabold uppercase leading-none tracking-[0.08em] text-fg-muted">
                    {series.releasedYear}
                  </span>
                ) : null}
              </div>
              <h1
                id="series-title"
                className="m-0 break-words font-display text-[clamp(26px,4.6vw,44px)] font-extrabold uppercase leading-[1.08] tracking-[-0.035em] text-fg"
              >
                {series.title}
              </h1>
              <AltTitles titles={series.titles} />
            </div>

            <div className="col-span-2 flex min-w-0 flex-col gap-4 lg:col-span-1 lg:col-start-2">
              <div className="flex flex-wrap gap-2.5">
                <Stat
                  name={fmt(messages.series.ratings, {
                    n: series.ratingCount.toLocaleString('en'),
                  })}
                  value={series.ratingCount > 0 ? ratingAvg.toFixed(1) : '—'}
                  icon={
                    <Star
                      size={18}
                      className="shrink-0 text-gold"
                      fill="currentColor"
                      aria-hidden="true"
                    />
                  }
                />
                <Stat
                  name={messages.series.chapters}
                  value={series.chapterCount.toLocaleString('en')}
                  icon={<List size={18} className="shrink-0 text-fg-subtle" aria-hidden="true" />}
                />
                <Stat
                  name={messages.layouts.bookmarks}
                  value={series.bookmarkCount.toLocaleString('en')}
                  icon={
                    <Bookmark size={18} className="shrink-0 text-fg-subtle" aria-hidden="true" />
                  }
                />
                {rank ? (
                  <Stat
                    tone="brand"
                    name={messages.layouts.rank}
                    value={`#${rank}`}
                    icon={
                      <Trophy size={18} className="shrink-0 text-brand-hover" aria-hidden="true" />
                    }
                  />
                ) : null}
              </div>

              <Credits
                people={series.people}
                releasedYear={series.releasedYear}
                className="max-w-[440px]"
              />
              <GenreChips genres={series.genres} />

              <div className="flex flex-wrap items-center gap-2.5">
                {continueChapter ? (
                  <>
                    {first ? (
                      <Link href={chapterHref(series.slug, first.number)} className={ghost}>
                        <BookOpen size={16} aria-hidden="true" />
                        {messages.series.readFirst}
                      </Link>
                    ) : null}
                    <Link
                      href={chapterHref(series.slug, continueChapter.number)}
                      className={primary}
                    >
                      <Play size={16} aria-hidden="true" />
                      {fmt(messages.series.continueChapter, {
                        chapter: fmt(messages.series.chapterShort, { n: continueChapter.number }),
                      })}
                    </Link>
                  </>
                ) : first ? (
                  <Link href={chapterHref(series.slug, first.number)} className={primary}>
                    <Play size={16} aria-hidden="true" />
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
                <DownloadButton entitled={canDownload} chapters={chapters} />
              </div>
            </div>
          </div>
        </section>

        {ads.top.show ? (
          <div className="container-page mt-6">
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

        {/* Body: the wide column beside the mockup's 320px rail — the ten newest chapters over
            the MPU. Explicit tracks, and a single stacked column below xl. */}
        <div className="container-page mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-5">
            {series.synopsis ? (
              <section aria-labelledby="synopsis-title" className="min-w-0 max-w-[860px]">
                <h2 id="synopsis-title" className="section-title mb-2">
                  {messages.series.synopsis}
                </h2>
                <Synopsis text={series.synopsis} title={series.title} />
              </section>
            ) : null}

            {/* The chapter table keeps the wide column it was built for — its search, sort and
                read filter never fit the 320px rail beside it. */}
            <section aria-labelledby="chapters-title" className="min-w-0">
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

            {series.linked && series.linked.type === 'novel' ? (
              <NovelCard
                title={series.linked.title}
                slug={series.linked.slug}
                author={author}
                className="min-w-0"
              />
            ) : null}
          </div>

          <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-20">
            {/* A desktop-only shortcut: the table beside it carries the same links, with search,
                sort and the read filter, at every width. */}
            {latestTen.length > 0 ? (
              <section
                aria-labelledby="latest-chapters-title"
                className="hidden min-w-0 rounded-[10px] border border-line bg-surface-1 p-3 xl:block"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 id="latest-chapters-title" className="section-title text-[16px]">
                    {messages.footer.latestUpdates}
                  </h2>
                  <a
                    href="#chapters-title"
                    className="shrink-0 text-[13px] font-semibold text-brand-hover hover:text-fg"
                  >
                    {fmt(messages.layouts.allChapters, { n: series.chapterCount })}
                  </a>
                </div>
                <ul className="mt-2 flex list-none flex-col p-0">
                  {latestTen.map((c, i) => (
                    <li key={c.id} className="min-w-0">
                      <Link
                        href={chapterHref(series.slug, c.number)}
                        className={cn(
                          'flex h-10 items-center gap-2 rounded-md border px-2 text-sm text-fg transition-colors hover:bg-surface-2',
                          i === 0 ? 'border-brand/40 bg-brand-wash' : 'border-transparent',
                          state.readIds.includes(c.id) && 'text-fg-subtle',
                        )}
                      >
                        <span className="shrink-0 font-semibold tabular-nums">
                          {fmt(messages.series.chapterShort, { n: c.number })}
                        </span>
                        {c.lock === 'early_access' ? (
                          <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm bg-gold/15 px-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-gold">
                            <Lock size={10} aria-hidden="true" />
                            {messages.series.earlyAccess}
                          </span>
                        ) : c.lock === 'premium' ? (
                          <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm bg-gold/15 px-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-gold">
                            <Lock size={10} aria-hidden="true" />
                            {messages.seriesDetail.premium}
                          </span>
                        ) : null}
                        <span aria-hidden="true" className="min-w-0 flex-1" />
                        {c.publishedAt ? (
                          <RelativeTime
                            iso={c.publishedAt}
                            className="shrink-0 text-[13px] tabular-nums text-fg-muted"
                          />
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
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
          </aside>
        </div>

        <RecommendedGrid items={recommended} className="container-page mt-6 min-w-0" />

        <div className="container-page mt-6">
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
