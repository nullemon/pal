import { formatChapterLabel } from '@palscans/core/formatting'
import { fmt, messages } from '@palscans/core/messages'
import { AdSlot, cn, Rail, RelativeTime } from '@palscans/ui'
import { ChevronRight, Play, Sparkles } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Rating, StatusBadge, TypeBadge } from '@/components/discovery/Badges'
import { homeHref } from '@/components/discovery/filters'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import { Pagination } from '@/components/discovery/Pagination'
import type { HeroSlide, RankedSeries, UpdateItem } from '@/components/discovery/types'
import { AnnouncementCard } from '@/components/home/AnnouncementCard'
import { ContinueReading } from '@/components/home/ContinueReading'
import { SponsoredCard } from '@/components/home/SponsoredCard'
import { siteFormatting } from '@/lib/copy/settings'
import { chapterAccess } from './chapter-access'
import type { HomeViewProps } from './types'

/**
 * The "glass" chrome of the mockup, in tokens: `fg` at low alpha reads as a white veil on the
 * dark theme and as an ink veil on the light one, so nothing here is hard-coded.
 */
const glass = 'border border-fg/12 bg-fg/6 backdrop-blur-md'
const railTitle =
  'm-0 font-display text-[20px] font-extrabold leading-tight tracking-[-0.01em] text-fg sm:text-[22px]'
const seeAll =
  'inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-brand-hover hover:text-fg'

function RailHead({ id, title, href }: { id: string; title: string; href: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className={railTitle}>
        {title}
      </h2>
      <Link href={href} className={seeAll}>
        {messages.layouts.seeAll}
        <ChevronRight size={15} aria-hidden="true" />
      </Link>
    </div>
  )
}

function Band({ children, label, id }: { children: ReactNode; label?: string; id?: string }) {
  return (
    <section aria-labelledby={id} aria-label={label} className="container-page flex flex-col gap-3">
      {children}
    </section>
  )
}

/** The full-bleed opening frame: the cover itself, blurred, is the backdrop. */
async function Hero({
  slide,
  others,
  eyebrow,
}: {
  slide: HeroSlide
  others: HeroSlide[]
  eyebrow: string
}) {
  const { chapterLabel: chapterStyle } = await siteFormatting()
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate min-h-[480px] overflow-hidden lg:min-h-[560px]"
    >
      <img
        src={slide.coverSrc}
        alt=""
        aria-hidden="true"
        width={COVER_WIDTH}
        height={COVER_HEIGHT}
        decoding="async"
        className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-70 blur-2xl saturate-150"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-linear-to-t from-bg via-bg/60 via-35% to-bg/25"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-linear-to-r from-bg/95 via-bg/45 via-45% to-transparent"
      />
      <div className="container-page flex min-h-[480px] flex-col justify-end gap-6 pb-10 pt-16 lg:min-h-[560px] lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 max-w-[760px] flex-col items-start gap-4">
          <span
            className={cn(
              glass,
              'inline-flex h-[26px] items-center gap-1.5 rounded-full px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-fg',
            )}
          >
            <Sparkles size={13} className="text-brand-hover" aria-hidden="true" />
            {eyebrow}
          </span>
          <h1
            id="hero-title"
            className="m-0 break-words font-display text-[clamp(32px,7vw,64px)] font-extrabold leading-[1.02] tracking-[-0.02em] text-fg"
          >
            {slide.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-fg">
            <TypeBadge type={slide.type} />
            <StatusBadge status={slide.status} />
            <Rating value={slide.rating} count={slide.ratingCount} size={14} />
            <span aria-hidden="true" className="text-fg-subtle">
              ·
            </span>
            <span>{fmt(messages.series.chapterCount, { n: slide.chapterCount })}</span>
          </div>
          {slide.synopsis ? (
            <p className="m-0 line-clamp-2 max-w-[640px] text-[15px] leading-[1.5] text-fg-muted">
              {slide.synopsis}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href={slide.latest?.href ?? slide.href}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 text-[15px] font-bold text-brand-ink transition-colors hover:bg-brand-hover"
            >
              <Play size={18} aria-hidden="true" />
              {slide.latest
                ? fmt(messages.layouts.readChapter, {
                    chapter: formatChapterLabel(slide.latest.number, chapterStyle),
                  })
                : messages.series.readFirst}
            </Link>
            <Link
              href={slide.href}
              className={cn(
                glass,
                'inline-flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-fg transition-colors hover:bg-fg/12',
              )}
            >
              {messages.layouts.seeAll}
            </Link>
          </div>
        </div>
        {others.length > 0 ? (
          <ul
            aria-label={messages.discovery.featuredSeries}
            className="m-0 hidden list-none gap-3 p-0 lg:flex"
          >
            {others.map((s) => (
              <li key={s.id}>
                <Link href={s.href} className="block w-[72px] shrink-0">
                  <img
                    src={s.coverSrc}
                    alt={s.title}
                    width={COVER_WIDTH}
                    height={COVER_HEIGHT}
                    loading="lazy"
                    decoding="async"
                    className={cn(
                      'block aspect-[2/3] w-full rounded-md border border-fg/12 object-cover opacity-70 transition-opacity hover:opacity-100',
                      s.mature && 'blur-md',
                    )}
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}

/** A trending tile: the rank set in outsized display type behind the cover. */
function RankTile({ item }: { item: RankedSeries }) {
  return (
    <Link href={item.href} className="group relative block overflow-hidden">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-[74px] select-none font-display text-[124px] font-extrabold leading-none tracking-[-0.08em] text-fg/10"
      >
        {item.rank}
      </span>
      <div className="relative ml-[52px] flex flex-col gap-1.5">
        <img
          src={item.coverSrc}
          alt=""
          width={COVER_WIDTH}
          height={COVER_HEIGHT}
          loading="lazy"
          decoding="async"
          className={cn(
            'block aspect-[2/3] w-full rounded-lg object-cover shadow-2 transition-transform duration-200 motion-safe:group-hover:-translate-y-1',
            item.mature && 'blur-md',
          )}
        />
        <span className="truncate text-[14px] font-semibold text-fg">{item.title}</span>
        <Rating value={item.rating} count={item.ratingCount} />
      </div>
    </Link>
  )
}

/** A compact "new chapter" tile — cover, series, chapter, age. */
async function ChapterTile({
  item,
  user,
  now,
  overrides,
  priority,
}: {
  item: UpdateItem
  user: HomeViewProps['user']
  now: Date
  overrides: HomeViewProps['overrides']
  priority: boolean
}) {
  const { chapterLabel: chapterStyle } = await siteFormatting()
  const latest = item.chapters[0]
  const access = latest ? chapterAccess(latest, user, now, overrides) : null
  return (
    <article className="flex min-w-0 flex-col gap-1.5">
      <Link href={item.href} className="group relative block">
        <img
          src={item.coverSrc}
          alt=""
          width={COVER_WIDTH}
          height={COVER_HEIGHT}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className={cn(
            'block aspect-[2/3] w-full rounded-lg object-cover shadow-2 transition-transform duration-200 motion-safe:group-hover:scale-[1.04]',
            item.mature && 'blur-md',
          )}
        />
        {access?.isNew ? (
          <span className="absolute left-2 top-2 inline-flex h-[18px] items-center rounded-full bg-brand px-2 text-[10px] font-bold tracking-[0.08em] text-brand-ink">
            {messages.home.new}
          </span>
        ) : null}
      </Link>
      <Link
        href={item.href}
        className="truncate text-[14px] font-semibold text-fg hover:text-brand-hover"
      >
        {item.title}
      </Link>
      {latest ? (
        <Link
          href={latest.href}
          className="flex min-w-0 flex-col text-[13px] hover:text-brand-hover"
        >
          <span className="truncate font-semibold text-fg">
            {formatChapterLabel(latest.number, chapterStyle)}
            {access?.locked ? ` · ${access.lockLabel ?? messages.series.locked}` : ''}
          </span>
          {latest.publishedAt ? (
            <RelativeTime
              iso={latest.publishedAt}
              className="truncate tabular-nums text-fg-muted"
            />
          ) : null}
        </Link>
      ) : (
        <span className="text-[13px] text-fg-subtle">{messages.series.emptyChapters}</span>
      )}
    </article>
  )
}

/**
 * Home layout **F · Cinematic Rows** (design/mockups/F/HomeF.dc.html): a full-bleed hero cut
 * from the featured cover itself, then horizontal rails — trending with outsized rank
 * numerals, continue reading, today's chapters and the weekly top. Presentational — every
 * row comes from `loadHomeView()`.
 */
export function HomeF({
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
  copy,
}: HomeViewProps) {
  const hero = slides[0]
  const items = feed.items
  const sponsoredAt = Math.min(6, items.length)
  const weekly = popular?.weekly ?? []

  return (
    <div className={`flex flex-col gap-8 pb-10 ${hero ? '' : 'pt-4'}`}>
      {/* The hero supplies this page's top spacing, and renders nothing on a catalogue
          too small to fill it — so a new site had its first section flush against the
          header. Pad only when it is absent; a populated home page is unchanged. */}
      {hero ? (
        <Hero slide={hero} others={slides.slice(1, 6)} eyebrow={copy('layouts.featured')} />
      ) : (
        <h1 className="sr-only">{messages.site.tagline}</h1>
      )}

      {trending.length > 0 ? (
        <Band id="trending-title">
          <RailHead id="trending-title" title={messages.layouts.trendingNow} href="/rankings" />
          <Rail label={messages.layouts.trendingNow} itemWidth="212px">
            {trending.slice(0, 10).map((s) => (
              <RankTile key={s.id} item={s} />
            ))}
          </Rail>
        </Band>
      ) : null}

      {resume.length > 0 ? (
        <div className="container-page">
          <ContinueReading items={resume} />
        </div>
      ) : null}

      {ads.top.show ? (
        <div className="container-page">
          <AdSlot
            slot="home_top"
            label={messages.ads.leaderboard}
            width={320}
            height={100}
            desktopWidth={970}
            desktopHeight={90}
            placeholder={ads.top.placeholder}
            tag={ads.top.tag}
          />
        </div>
      ) : null}

      {sections.latest ? (
        <Band id="today-title">
          <RailHead id="today-title" title={messages.layouts.newChaptersToday} href="/browse" />
          {items.length === 0 ? (
            <p className="m-0 py-6 text-[14px] text-fg-muted">{copy('home.emptyUpdates')}</p>
          ) : (
            <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {items.map((item, i) => (
                <div key={item.id} className="contents">
                  {i === sponsoredAt && ads.infeed.show ? (
                    <div className="col-span-3 min-w-0 sm:col-span-2">
                      <SponsoredCard placeholder={ads.infeed.placeholder} />
                    </div>
                  ) : null}
                  <ChapterTile
                    item={item}
                    user={user}
                    now={now}
                    overrides={overrides}
                    priority={i < 6}
                  />
                </div>
              ))}
              {sponsoredAt >= items.length && ads.infeed.show ? (
                <div className="col-span-3 min-w-0 sm:col-span-2">
                  <SponsoredCard placeholder={ads.infeed.placeholder} />
                </div>
              ) : null}
            </div>
          )}
          <Pagination
            page={feed.page}
            totalPages={feed.totalPages}
            href={(p) => homeHref({ ...params, page: p })}
            className="mt-2"
          />
        </Band>
      ) : null}

      <div className="container-page grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {weekly.length > 0 ? (
          <section aria-labelledby="weekly-title" className="flex min-w-0 flex-col gap-3">
            <RailHead id="weekly-title" title={messages.layouts.topThisWeek} href="/rankings" />
            <Rail label={messages.layouts.topThisWeek} itemWidth="112px">
              {weekly.slice(0, 12).map((s) => (
                <Link key={s.id} href={s.href} className="group block">
                  <img
                    src={s.coverSrc}
                    alt={s.title}
                    width={COVER_WIDTH}
                    height={COVER_HEIGHT}
                    loading="lazy"
                    decoding="async"
                    className={cn(
                      'block aspect-[2/3] w-full rounded-lg object-cover shadow-2 transition-transform duration-200 motion-safe:group-hover:scale-[1.05]',
                      s.mature && 'blur-md',
                    )}
                  />
                </Link>
              ))}
            </Rail>
          </section>
        ) : (
          <div />
        )}
        <aside className="flex min-w-0 flex-col gap-4">
          {ads.sidebar.show ? (
            <AdSlot
              slot="home_sidebar"
              label={messages.ads.mpu}
              width={300}
              height={250}
              placeholder={ads.sidebar.placeholder}
              tag={ads.sidebar.tag}
              className="lg:mx-0"
            />
          ) : null}
          <AnnouncementCard announcement={announcement} />
        </aside>
      </div>
    </div>
  )
}
