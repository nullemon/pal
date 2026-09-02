import { fmt, messages } from '@palscans/core/messages'
import { AdSlot, cn, RelativeTime } from '@palscans/ui'
import { ArrowRight, Lock } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Pagination } from '@/components/discovery/Pagination'
import { homeHref } from '@/components/discovery/filters'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import type { ChapterSummary, HeroSlide, UpdateItem } from '@/components/discovery/types'
import { AnnouncementCard } from '@/components/home/AnnouncementCard'
import { ContinueReading } from '@/components/home/ContinueReading'
import { PopularSidebar } from '@/components/home/PopularSidebar'
import { SponsoredCard } from '@/components/home/SponsoredCard'
import { chapterAccess } from './chapter-access'
import type { HomeViewProps } from './types'

const rule = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted'
const eyebrow = 'flex items-center gap-3'
const paperBtn =
  'inline-flex h-11 items-center gap-2.5 rounded-sm bg-fg px-6 text-[14px] font-bold text-bg transition-opacity hover:opacity-90'

/** The editorial rule + label that opens every band. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className={eyebrow}>
      <span aria-hidden="true" className="block h-px w-7 bg-gold" />
      <span className={rule}>{children}</span>
    </div>
  )
}

function BandHeader({
  id,
  title,
  href,
  label,
}: {
  id: string
  title: string
  href: string
  label: string
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
      <h2
        id={id}
        className="m-0 font-display text-[24px] font-extrabold leading-tight tracking-[-0.02em] text-fg"
      >
        {title}
      </h2>
      <Link href={href} className={cn(rule, 'inline-flex items-center gap-1.5 hover:text-fg')}>
        {label}
        <ArrowRight size={13} aria-hidden="true" />
      </Link>
    </div>
  )
}

function HeroBand({ slide }: { slide: HeroSlide }) {
  const meta = [
    messages.series.type[slide.type],
    messages.series.status[slide.status],
    slide.ratingCount > 0 ? slide.rating.toFixed(1) : null,
    fmt(messages.series.chapterCount, { n: slide.chapterCount }),
  ].filter((v): v is string => v !== null)
  return (
    <section aria-labelledby="hero-title" className="border-b border-line py-7 lg:py-9">
      <div className="grid items-center gap-8 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-7">
          <Eyebrow>{messages.layouts.featured}</Eyebrow>
          <h1
            id="hero-title"
            className="m-0 break-words font-display text-[clamp(38px,7.4vw,88px)] font-extrabold leading-[0.94] tracking-[-0.035em] text-fg"
          >
            {slide.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {meta.map((m, i) => (
              <span key={m} className="flex items-center gap-2.5">
                {i > 0 ? (
                  <span aria-hidden="true" className="text-fg-subtle">
                    ·
                  </span>
                ) : null}
                <span className={cn(rule, i === 2 && 'text-gold')}>{m}</span>
              </span>
            ))}
          </div>
          {slide.synopsis ? (
            <p className="m-0 max-w-[660px] text-[15px] leading-[1.6] text-fg-muted">
              {slide.synopsis}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-5">
            <Link href={slide.latest?.href ?? slide.href} className={paperBtn}>
              {slide.latest
                ? fmt(messages.layouts.readChapter, {
                    chapter: fmt(messages.series.chapterShort, { n: slide.latest.number }),
                  })
                : messages.series.readFirst}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link
              href={slide.href}
              className={cn(rule, 'inline-flex items-center gap-2 text-brand-hover hover:text-fg')}
            >
              {slide.latest
                ? fmt(messages.layouts.latestChapter, {
                    chapter: fmt(messages.series.chapterShort, { n: slide.latest.number }),
                  })
                : messages.layouts.seeAll}
            </Link>
          </div>
        </div>
        <div className="min-w-0 lg:col-span-5">
          <Link href={slide.href} className="group block">
            <img
              src={slide.coverSrc}
              alt={fmt(messages.layouts.coverCredit, { title: slide.title })}
              width={COVER_WIDTH}
              height={COVER_HEIGHT}
              decoding="async"
              className={cn(
                'ml-auto block h-auto w-full max-w-[380px] rounded-sm border border-line object-cover',
                slide.mature && 'blur-md',
              )}
            />
          </Link>
        </div>
      </div>
    </section>
  )
}

function ChapterLine({
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
      className="flex min-w-0 items-center justify-between gap-3 border-b border-line-soft py-1.5 text-[13px] transition-colors hover:border-fg-subtle"
    >
      <span
        className={cn(
          'inline-flex min-w-0 items-center gap-2 truncate',
          first ? 'font-bold text-fg' : 'font-semibold text-fg-muted',
        )}
      >
        {fmt(messages.series.chapterShort, { n: chapter.number })}
        {first && access.isNew ? (
          <span className={cn(rule, 'text-brand-hover')}>{messages.home.new}</span>
        ) : null}
        {access.locked ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gold">
            <Lock size={11} aria-label={messages.series.locked} />
            {access.lockLabel}
          </span>
        ) : null}
      </span>
      {chapter.publishedAt ? (
        <RelativeTime
          iso={chapter.publishedAt}
          className={cn('shrink-0 tabular-nums text-[12px]', first ? 'text-fg' : 'text-fg-subtle')}
        />
      ) : null}
    </Link>
  )
}

function FeedEntry({
  item,
  user,
  now,
  overrides,
}: {
  item: UpdateItem
  user: HomeViewProps['user']
  now: Date
  overrides: HomeViewProps['overrides']
}) {
  return (
    <article className="flex min-w-0 gap-4 border-b border-line py-4">
      <Link href={item.href} className="block w-[72px] shrink-0" tabIndex={-1} aria-hidden="true">
        <img
          src={item.coverSrc}
          alt=""
          width={COVER_WIDTH}
          height={COVER_HEIGHT}
          loading="lazy"
          decoding="async"
          className={cn(
            'block h-auto w-full rounded-sm border border-line object-cover',
            item.mature && 'blur-md',
          )}
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link
            href={item.href}
            className="min-w-0 font-display text-[19px] font-extrabold leading-tight tracking-[-0.02em] text-fg hover:text-brand-hover"
          >
            {item.title}
          </Link>
          <span className={rule}>{messages.series.type[item.type]}</span>
          {item.ratingCount > 0 ? (
            <span className={cn(rule, 'text-gold')}>{item.rating.toFixed(1)}</span>
          ) : null}
        </div>
        <div className="flex flex-col">
          {item.chapters.slice(0, 3).map((c, i) => (
            <ChapterLine
              key={c.id}
              chapter={c}
              first={i === 0}
              access={chapterAccess(c, user, now, overrides)}
            />
          ))}
          {item.chapters.length === 0 ? (
            <span className="py-1.5 text-[13px] text-fg-subtle">{messages.series.emptyChapters}</span>
          ) : null}
        </div>
      </div>
    </article>
  )
}

/**
 * Home layout **C · Editorial Noir** (design/mockups/C/HomeC.dc.html): one editorial hero,
 * a "new this week" band, then the updates broadsheet with the popular column beside it.
 * Presentational — every row comes from `loadHomeView()`.
 */
export function HomeC({
  params,
  user,
  now,
  overrides,
  slides,
  feed,
  popular,
  announcement,
  newest,
  resume,
  sections,
  ads,
}: HomeViewProps) {
  const hero = slides[0]
  const items = feed.items
  const sponsoredAt = Math.min(4, items.length)
  return (
    <div className="container-page flex flex-col gap-8 pb-10">
      <h1 className="sr-only">{messages.site.tagline}</h1>
      {hero ? <HeroBand slide={hero} /> : null}

      {resume.length > 0 ? <ContinueReading items={resume} /> : null}

      {newest.length > 0 ? (
        <section aria-labelledby="newest-title" className="flex flex-col gap-4">
          <BandHeader
            id="newest-title"
            title={messages.layouts.newThisWeek}
            href="/browse?sort=newest"
            label={messages.home.viewAll}
          />
          <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-5 p-0 sm:grid-cols-3 lg:grid-cols-5">
            {newest.slice(0, 5).map((s) => (
              <li key={s.id} className="flex min-w-0 flex-col gap-2">
                <Link href={s.href} className="group flex min-w-0 flex-col gap-2">
                  <img
                    src={s.coverSrc}
                    alt=""
                    width={COVER_WIDTH}
                    height={COVER_HEIGHT}
                    loading="lazy"
                    decoding="async"
                    className={cn(
                      'block h-auto w-full rounded-sm border border-line object-cover',
                      s.mature && 'blur-md',
                    )}
                  />
                  <span className="truncate font-display text-[15px] font-extrabold tracking-[-0.01em] text-fg group-hover:text-brand-hover">
                    {s.title}
                  </span>
                </Link>
                <span className="flex min-w-0 items-center gap-2 text-[12px] text-fg-subtle">
                  <span className="shrink-0 font-semibold text-fg-muted">
                    {fmt(messages.series.chapterShort, { n: s.chapterCount })}
                  </span>
                  {s.lastChapterAt ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <RelativeTime iso={s.lastChapterAt} className="truncate tabular-nums" />
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ads.top.show ? (
        <div>
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

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        {sections.latest ? (
          <section aria-labelledby="latest-title" className="flex min-w-0 flex-col gap-4">
            <BandHeader
              id="latest-title"
              title={messages.home.latestUpdates}
              href="/browse"
              label={messages.layouts.allUpdates}
            />
            {items.length === 0 ? (
              <p className="m-0 py-6 text-[14px] text-fg-muted">{messages.home.emptyUpdates}</p>
            ) : (
              <div className="flex flex-col">
                {items.map((item, i) => (
                  <div key={item.id} className="contents">
                    {i === sponsoredAt && ads.infeed.show ? (
                      <div className="border-b border-line py-4">
                        <SponsoredCard placeholder={ads.infeed.placeholder} />
                      </div>
                    ) : null}
                    <FeedEntry item={item} user={user} now={now} overrides={overrides} />
                  </div>
                ))}
                {sponsoredAt >= items.length && ads.infeed.show ? (
                  <div className="border-b border-line py-4">
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
          </section>
        ) : (
          <div />
        )}

        <aside className="flex min-w-0 flex-col gap-5">
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
