import { fmt, messages } from '@palscans/core/messages'
import { AdSlot, cn, RelativeTime } from '@palscans/ui'
import { ArrowRight, Lock } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Rating, StatusBadge, TypeBadge } from '@/components/discovery/Badges'
import { homeHref, type SeriesTypeValue } from '@/components/discovery/filters'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import { Pagination } from '@/components/discovery/Pagination'
import type { ChapterSummary, HeroSlide, UpdateItem } from '@/components/discovery/types'
import { AnnouncementCard } from '@/components/home/AnnouncementCard'
import { ContinueReading } from '@/components/home/ContinueReading'
import { PopularSidebar } from '@/components/home/PopularSidebar'
import { SponsoredCard } from '@/components/home/SponsoredCard'
import { chapterAccess } from './chapter-access'
import type { HomeViewProps } from './types'

/**
 * Daylight is a *soft* direction, not a light-only one: every surface below is a token, so
 * the same markup reads as white-on-lilac under `data-theme="light"` and as a raised dark
 * card under the dark default. No literal white or grey appears anywhere in this file.
 */
const card = 'rounded-lg border border-line bg-surface-1 shadow-2'
const pill = 'inline-flex items-center rounded-full px-3 text-[12px] font-bold'
const sectionTitle = 'm-0 font-display text-[22px] font-extrabold tracking-[-0.01em] text-fg'

/** The gold rating lozenge the mockup puts beside every title. */
function RatingPill({ value, count }: { value: number; count: number }) {
  if (count === 0 || value <= 0) return null
  return (
    <span className={cn(pill, 'h-6 gap-1 bg-gold/15 text-gold')}>
      <Rating value={value} count={count} className="text-[12px] text-gold" />
    </span>
  )
}

/** One of the three featured cards on the tinted hero band. */
function FeatureCard({ slide, raised }: { slide: HeroSlide; raised: boolean }) {
  const genresLine = slide.synopsis
  return (
    <article className={cn(card, 'flex min-w-0 gap-4 p-4', raised && 'lg:-mt-3.5')}>
      <Link href={slide.href} className="block w-[104px] shrink-0 sm:w-[136px]">
        <img
          src={slide.coverSrc}
          alt=""
          width={COVER_WIDTH}
          height={COVER_HEIGHT}
          decoding="async"
          className={cn(
            'block aspect-[2/3] h-auto w-full rounded-md object-cover',
            slide.mature && 'blur-md',
          )}
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <TypeBadge type={slide.type} />
          <StatusBadge status={slide.status} />
        </div>
        <h2 className="m-0 font-display text-[19px] font-extrabold leading-tight tracking-[-0.01em] text-fg">
          <Link href={slide.href} className="hover:text-brand-hover">
            {slide.title}
          </Link>
        </h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <RatingPill value={slide.rating} count={slide.ratingCount} />
          {slide.latest ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg-muted">
              <span className="shrink-0">
                {fmt(messages.series.chapterShort, { n: slide.latest.number })}
              </span>
              {slide.latest.publishedAt ? (
                <>
                  <span aria-hidden="true">·</span>
                  <RelativeTime iso={slide.latest.publishedAt} className="truncate tabular-nums" />
                </>
              ) : null}
            </span>
          ) : null}
        </div>
        {genresLine ? (
          <p className="m-0 line-clamp-2 text-[13px] leading-[1.5] text-fg-muted">{genresLine}</p>
        ) : null}
        <Link
          href={slide.latest?.href ?? slide.href}
          className={cn(
            pill,
            'mt-auto h-9 w-fit gap-1.5 border-[1.5px] border-brand text-brand-hover transition-colors hover:bg-brand-wash',
          )}
        >
          {messages.discovery.readNow}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}

/** A chapter chip inside an update card — the mockup's rounded "Ch. 301 · 12 min ago" row. */
function ChapterChip({
  chapter,
  first,
  access,
}: {
  chapter: ChapterSummary
  first: boolean
  access: ReturnType<typeof chapterAccess>
}) {
  return (
    <Link
      href={chapter.href}
      className="flex h-[30px] min-w-0 items-center justify-between gap-2 rounded-md bg-surface-2 px-2.5 text-[13px] font-bold transition-colors hover:bg-brand-wash"
    >
      <span
        className={cn(
          'inline-flex min-w-0 items-center gap-1.5 truncate',
          first ? 'text-brand-hover' : 'text-fg',
        )}
      >
        {fmt(messages.series.chapterShort, { n: chapter.number })}
        {access.locked ? (
          <Lock size={11} className="shrink-0 text-gold" aria-label={messages.series.locked} />
        ) : null}
      </span>
      {chapter.publishedAt ? (
        <RelativeTime
          iso={chapter.publishedAt}
          className={cn(
            'shrink-0 text-[12px] font-normal tabular-nums',
            access.isNew ? 'text-brand-hover' : 'text-fg-subtle',
          )}
        />
      ) : null}
    </Link>
  )
}

function UpdateCard({
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
  return (
    <article className={cn(card, 'flex min-w-0 flex-col gap-3 p-3')}>
      <div className="flex min-w-0 gap-3">
        <Link href={item.href} className="block w-[80px] shrink-0" tabIndex={-1} aria-hidden="true">
          <img
            src={item.coverSrc}
            alt=""
            width={COVER_WIDTH}
            height={COVER_HEIGHT}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            className={cn(
              'block aspect-[2/3] h-auto w-full rounded-md object-cover',
              item.mature && 'blur-md',
            )}
          />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <TypeBadge type={item.type} className="self-start" />
          <h3 className="m-0 font-display text-[14px] font-extrabold leading-[1.3] tracking-[-0.005em]">
            <Link href={item.href} className="line-clamp-3 text-fg hover:text-brand-hover">
              {item.title}
            </Link>
          </h3>
          <Rating value={item.rating} count={item.ratingCount} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        {item.chapters.slice(0, 2).map((c, i) => (
          <ChapterChip
            key={c.id}
            chapter={c}
            first={i === 0}
            access={chapterAccess(c, user, now, overrides)}
          />
        ))}
        {item.chapters.length === 0 ? (
          <span className="text-[12px] text-fg-subtle">{messages.series.emptyChapters}</span>
        ) : null}
      </div>
    </article>
  )
}

function Band({ children }: { children: ReactNode }) {
  return <div className="container-page flex flex-col gap-4">{children}</div>
}

/**
 * Home layout **E · Daylight** (design/mockups/E/HomeE.dc.html): a tinted hero band of
 * featured cards, then soft update cards in a grid beside the Popular column. Every colour
 * is a design token, so the direction reads light under the light theme and stays legible
 * under the dark one. Presentational — every row comes from `loadHomeView()`.
 */
export function HomeE({
  params,
  user,
  now,
  overrides,
  slides,
  feed,
  popular,
  announcement,
  resume,
  sections,
  ads,
}: HomeViewProps) {
  const items = feed.items
  const sponsoredAt = Math.min(6, items.length)
  const featured = slides.slice(0, 3)
  const tabs: ReadonlyArray<{ type?: SeriesTypeValue; label: string }> = [
    { label: messages.discovery.all },
    { type: 'manhwa', label: messages.series.type.manhwa },
    { type: 'manhua', label: messages.series.type.manhua },
    { type: 'manga', label: messages.series.type.manga },
  ]

  return (
    <div className="flex flex-col gap-7 pb-10">
      <h1 className="sr-only">{messages.site.tagline}</h1>

      {featured.length > 0 ? (
        <section
          aria-label={messages.layouts.featured}
          className="bg-linear-to-b from-brand-wash to-bg pb-6 pt-7"
        >
          <div className="container-page grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
            {featured.map((slide, i) => (
              <FeatureCard key={slide.id} slide={slide} raised={i === 1 && featured.length === 3} />
            ))}
          </div>
        </section>
      ) : null}

      {resume.length > 0 ? (
        <Band>
          <ContinueReading items={resume} />
        </Band>
      ) : null}

      {ads.top.show ? (
        <div className="container-page">
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

      <div className="container-page grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {sections.latest ? (
          <section aria-labelledby="latest-title" className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="latest-title" className={sectionTitle}>
                {messages.home.latestUpdates}
              </h2>
              <nav aria-label={messages.browse.type} className="flex flex-wrap gap-1.5">
                {tabs.map((t) => {
                  const active = (t.type ?? undefined) === params.type
                  return (
                    <Link
                      key={t.label}
                      href={homeHref({ type: t.type })}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        pill,
                        'h-7',
                        active
                          ? 'bg-brand text-brand-ink'
                          : 'border border-line bg-surface-1 text-fg-muted hover:text-fg',
                      )}
                    >
                      {t.label}
                    </Link>
                  )
                })}
              </nav>
            </div>

            {items.length === 0 ? (
              <p className="m-0 py-6 text-[14px] text-fg-muted">{messages.home.emptyUpdates}</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item, i) => (
                  <div key={item.id} className="contents">
                    {i === sponsoredAt && ads.infeed.show ? (
                      <div className="min-w-0">
                        <SponsoredCard placeholder={ads.infeed.placeholder} />
                      </div>
                    ) : null}
                    <UpdateCard
                      item={item}
                      user={user}
                      now={now}
                      overrides={overrides}
                      priority={i < 4}
                    />
                  </div>
                ))}
                {sponsoredAt >= items.length && ads.infeed.show ? (
                  <div className="min-w-0">
                    <SponsoredCard placeholder={ads.infeed.placeholder} />
                  </div>
                ) : null}
              </div>
            )}

            <Pagination
              page={feed.page}
              totalPages={feed.totalPages}
              href={(p) => homeHref({ ...params, page: p })}
              className="mt-1"
            />
          </section>
        ) : (
          <div />
        )}

        <aside className="flex min-w-0 flex-col gap-5">
          {popular ? (
            <div className={cn(card, 'p-4')}>
              <PopularSidebar lists={popular} />
            </div>
          ) : null}
          {ads.sidebar.show ? (
            <div className="hidden lg:block">
              <AdSlot
                slot="home_sidebar"
                label={messages.ads.mpu}
                width={300}
                height={250}
                placeholder={ads.sidebar.placeholder}
                className="lg:mx-0"
              />
            </div>
          ) : null}
          <AnnouncementCard announcement={announcement} />
        </aside>
      </div>
    </div>
  )
}
