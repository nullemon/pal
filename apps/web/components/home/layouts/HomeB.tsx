import { fmt, messages } from '@palscans/core/messages'
import { AdSlot, cn, RelativeTime } from '@palscans/ui'
import { Bookmark, BookOpen, List, Sparkles, Star } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { StatusBadge, TypeBadge } from '@/components/discovery/Badges'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import type { ChapterSummary, HeroSlide, SeriesSummary } from '@/components/discovery/types'
import { AnnouncementCard } from '@/components/home/AnnouncementCard'
import { ContinueReading } from '@/components/home/ContinueReading'
import { LatestUpdates } from '@/components/home/LatestUpdates'
import { PopularSidebar } from '@/components/home/PopularSidebar'
import type { HomeViewProps } from './types'

/** Anything with a cover and a newest chapter fits the "Up next" strip: slides or trending. */
type UpNextItem = SeriesSummary & { latest: ChapterSummary | null }

const count = (n: number): string => n.toLocaleString('en')

/** One line of the featured card's stat row: an icon and its value. */
function Stat({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-fg-subtle" aria-hidden="true">
        {icon}
      </span>
      {children}
    </span>
  )
}

/** A cover + title + chapter row of the "Up next" strip under the featured card. */
function UpNextRow({ item }: { item: UpNextItem }) {
  return (
    <li className="min-w-0">
      <Link
        href={item.href}
        className="flex min-w-0 items-center gap-3 rounded-md p-1 transition-colors duration-[120ms] hover:bg-brand-wash"
      >
        <img
          src={item.coverSrc}
          alt=""
          width={COVER_WIDTH}
          height={COVER_HEIGHT}
          loading="lazy"
          decoding="async"
          className={cn(
            'block h-[66px] w-11 shrink-0 rounded-[5px] bg-surface-3 object-cover',
            item.mature && 'blur-md',
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="block truncate text-[14px] font-semibold leading-[18px] text-fg">
            {item.title}
          </span>
          <span className="block truncate text-[13px] leading-[17px] text-fg-muted">
            {item.latest
              ? fmt(messages.series.chapterShort, { n: item.latest.number })
              : messages.series.emptyChapters}
            {item.latest?.publishedAt ? (
              <>
                <span aria-hidden="true"> · </span>
                <RelativeTime iso={item.latest.publishedAt} className="tabular-nums" />
              </>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  )
}

/**
 * The one hero object of this direction: cover, badge row, title, stats, synopsis, actions —
 * and the "Up next" strip closing the same card. `slides[0]` is the only featured series;
 * everything else in the card is the tail of the hero list (or Trending, when the hero is
 * short). The mockup's genre chips are dropped: `HeroSlide` carries no genres.
 */
function FeaturedCard({ slide, upNext }: { slide: HeroSlide; upNext: UpNextItem[] }) {
  const chapterLabel = slide.latest
    ? fmt(messages.series.chapterShort, { n: slide.latest.number })
    : null
  return (
    <section
      aria-labelledby="featured-title"
      className="relative isolate overflow-hidden rounded-lg border border-line bg-surface-1"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-br from-brand-wash via-transparent to-transparent"
      />
      <div className="flex flex-col gap-5 p-4 sm:p-5 md:flex-row md:gap-8 md:p-6">
        <Link
          href={slide.href}
          tabIndex={-1}
          aria-hidden="true"
          className="mx-auto block w-[150px] shrink-0 sm:w-[190px] md:mx-0 md:w-[240px] lg:w-[290px]"
        >
          <img
            src={slide.coverSrc}
            alt=""
            width={COVER_WIDTH}
            height={COVER_HEIGHT}
            decoding="async"
            className={cn(
              'block aspect-[2/3] h-auto w-full rounded-md bg-surface-3 object-cover shadow-2',
              slide.mature && 'blur-md',
            )}
          />
        </Link>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-3.5 md:gap-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] font-semibold">
            <span className="inline-flex items-center gap-1.5 text-brand-hover">
              <Sparkles size={14} aria-hidden="true" />
              {messages.layouts.featured}
            </span>
            <span aria-hidden="true" className="text-line">
              |
            </span>
            <TypeBadge type={slide.type} />
            <StatusBadge status={slide.status} />
            {slide.lastChapterAt ? (
              <span className="font-medium text-fg-muted">
                {messages.common.updated.replace('{time}', '')}
                <RelativeTime iso={slide.lastChapterAt} />
              </span>
            ) : null}
          </div>

          <h1
            id="featured-title"
            className="m-0 break-words font-display text-[clamp(24px,5.2vw,44px)] font-extrabold leading-[1.08] tracking-[-0.02em] text-fg"
          >
            <Link href={slide.href} className="hover:text-brand-hover">
              {slide.title}
            </Link>
          </h1>

          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-[13px] font-medium text-fg-muted sm:text-[14px]">
            {slide.ratingCount > 0 && slide.rating > 0 ? (
              <Stat icon={<Star size={16} className="text-gold" fill="currentColor" />}>
                <span className="font-bold tabular-nums text-fg">{slide.rating.toFixed(1)}</span>
                <span aria-hidden="true">·</span>
                <span>{fmt(messages.series.ratings, { n: count(slide.ratingCount) })}</span>
              </Stat>
            ) : null}
            <Stat icon={<List size={16} />}>
              {fmt(messages.series.chapterCount, { n: count(slide.chapterCount) })}
            </Stat>
            <Stat icon={<Bookmark size={16} />}>
              {fmt(messages.series.bookmarks, { n: count(slide.bookmarkCount) })}
            </Stat>
          </div>

          {slide.synopsis ? (
            <p className="m-0 line-clamp-3 max-w-[680px] text-[14px] leading-[1.6] text-fg-muted sm:text-[15px]">
              {slide.synopsis}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
            <Link
              href={slide.latest?.href ?? slide.href}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-brand px-5 text-[15px] font-bold text-brand-ink transition-colors duration-[120ms] hover:bg-brand-hover"
            >
              <BookOpen size={18} aria-hidden="true" />
              {chapterLabel
                ? fmt(messages.layouts.readChapter, { chapter: chapterLabel })
                : messages.series.readFirst}
            </Link>
            <Link
              href={slide.href}
              className="inline-flex h-11 items-center gap-2 rounded-md border border-line px-4 text-[15px] font-semibold text-fg transition-colors duration-[120ms] hover:border-brand hover:bg-brand-wash"
            >
              <Bookmark size={18} aria-hidden="true" />
              {messages.series.bookmark}
            </Link>
          </div>
        </div>
      </div>

      {upNext.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-line bg-surface-2 px-4 py-3 sm:px-5 md:flex-row md:items-center md:gap-5 md:px-6">
          <h2
            id="upnext-title"
            className="m-0 shrink-0 font-display text-[12px] font-extrabold uppercase tracking-[0.08em] text-fg-muted md:w-[76px]"
          >
            {messages.layouts.upNext}
          </h2>
          <ul
            aria-labelledby="upnext-title"
            className="m-0 grid min-w-0 flex-1 list-none grid-cols-1 gap-x-4 gap-y-2 p-0 sm:grid-cols-2 xl:grid-cols-4"
          >
            {upNext.map((item) => (
              <UpNextRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

/**
 * Home layout **B · Violet Refined** (design/mockups/B/HomeB.dc.html): one featured card
 * instead of A's rotating hero — cover, badges, stats, synopsis and actions, closed by an
 * "Up next" strip — then Continue reading, the leaderboard, and the classic two-column body
 * of Latest updates beside the Popular sidebar. Fewer sections than A, one hero object.
 * Presentational — every row comes from `loadHomeView()`.
 */
export function HomeB({
  params,
  user,
  now,
  overrides,
  slides,
  trending,
  feed,
  popular,
  announcement,
  resume,
  sections,
  ads,
}: HomeViewProps) {
  const featured = slides[0]
  // The rest of the hero list fills "Up next"; with a one-slide hero, Trending stands in
  // (minus the featured series itself, which is already the card above).
  const pool: UpNextItem[] =
    slides.length > 1 ? slides.slice(1) : trending.filter((s) => s.id !== featured?.id)
  const upNext = pool.slice(0, 4)

  return (
    <div className="container-page flex flex-col gap-5 pb-8 pt-4">
      {featured ? (
        <FeaturedCard slide={featured} upNext={upNext} />
      ) : (
        <h1 className="sr-only">{messages.site.tagline}</h1>
      )}

      <ContinueReading items={resume} />

      {ads.top.show ? (
        <div className="py-1">
          <div className="hidden md:block">
            <AdSlot
              slot="home_top"
              label={messages.ads.leaderboard}
              width={970}
              height={90}
              placeholder={ads.top.placeholder}
            />
          </div>
          <div className="md:hidden">
            <AdSlot
              slot="home_top"
              label={messages.ads.leaderboard}
              width={320}
              height={100}
              placeholder={ads.top.placeholder}
            />
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {sections.latest ? (
          <LatestUpdates
            feed={feed}
            type={params.type}
            user={user}
            now={now}
            overrides={overrides}
            sponsored={ads.infeed.show ? { placeholder: ads.infeed.placeholder } : null}
          />
        ) : (
          <div />
        )}
        <aside className="flex min-w-0 flex-col gap-2.5">
          {popular ? <PopularSidebar lists={popular} /> : null}
          {ads.sidebar.show ? (
            <div className="hidden lg:block">
              <AdSlot
                slot="home_sidebar"
                label={messages.ads.mpu}
                width={300}
                height={250}
                placeholder={ads.sidebar.placeholder}
              />
            </div>
          ) : null}
          <AnnouncementCard announcement={announcement} />
        </aside>
      </div>
    </div>
  )
}
