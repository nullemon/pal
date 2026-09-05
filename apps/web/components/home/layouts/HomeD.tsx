import { fmt, messages } from '@palscans/core/messages'
import { AdSlot, cn, RelativeTime } from '@palscans/ui'
import { Lock } from 'lucide-react'
import Link from 'next/link'
import { Rating, StatusBadge, TypeBadge } from '@/components/discovery/Badges'
import { homeHref, type SeriesTypeValue } from '@/components/discovery/filters'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import { Pagination } from '@/components/discovery/Pagination'
import type { UpdateItem } from '@/components/discovery/types'
import { AnnouncementCard } from '@/components/home/AnnouncementCard'
import { ContinueReading } from '@/components/home/ContinueReading'
import { SponsoredCard } from '@/components/home/SponsoredCard'
import { chapterAccess } from './chapter-access'
import type { HomeViewProps } from './types'

const facetTitle =
  'text-[11px] font-bold uppercase tracking-[0.1em] text-fg-subtle [font-variant-caps:all-small-caps]'

/** One catalogue tile: cover, rating, title, latest chapter and its age. */
function CatalogCard({
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
  const latest = item.chapters[0]
  const access = latest ? chapterAccess(latest, user, now, overrides) : null
  return (
    <article className="flex min-w-0 flex-col gap-2">
      <Link
        href={item.href}
        className="group relative block overflow-hidden rounded-md border border-line bg-surface-2"
      >
        <img
          src={item.coverSrc}
          alt=""
          width={COVER_WIDTH}
          height={COVER_HEIGHT}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className={cn(
            'block h-auto w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.03]',
            item.mature && 'blur-md',
          )}
        />
        {item.ratingCount > 0 ? (
          <span className="absolute left-1.5 top-1.5 inline-flex h-5 items-center rounded-sm bg-bg/85 px-1.5 text-[11px] font-bold tabular-nums text-gold">
            {item.rating.toFixed(1)}
          </span>
        ) : null}
      </Link>
      <Link
        href={item.href}
        className="line-clamp-2 text-[13.5px] font-bold leading-[17px] text-fg hover:text-brand-hover"
      >
        {item.title}
      </Link>
      {latest ? (
        <Link
          href={latest.href}
          className="flex min-w-0 items-center justify-between gap-2 text-[12px] text-fg-muted hover:text-fg"
        >
          <span className="inline-flex min-w-0 items-center gap-1 truncate font-semibold">
            {fmt(messages.series.chapterShort, { n: latest.number })}
            {access?.locked ? (
              <Lock size={11} className="text-gold" aria-label={messages.series.locked} />
            ) : null}
          </span>
          {latest.publishedAt ? (
            <RelativeTime
              iso={latest.publishedAt}
              className={cn(
                'shrink-0 tabular-nums',
                access?.isNew ? 'text-brand-hover' : 'text-fg-subtle',
              )}
            />
          ) : null}
        </Link>
      ) : (
        <span className="text-[12px] text-fg-subtle">{messages.series.emptyChapters}</span>
      )}
      <div className="flex h-[18px] items-center gap-1.5">
        <TypeBadge type={item.type} />
        {item.status !== 'ongoing' ? <StatusBadge status={item.status} /> : null}
      </div>
    </article>
  )
}

/**
 * Home layout **D · Catalog Grid** (design/mockups/D/HomeD.dc.html): a faceted catalogue —
 * type tabs and genre facets in a rail, a dense cover grid of the latest updates with the
 * native sponsored cell inside it, and real `?page=` pagination.
 * Presentational — every row comes from `loadHomeView()`.
 */
export function HomeD({
  params,
  user,
  now,
  overrides,
  feed,
  trending,
  announcement,
  genres,
  resume,
  sections,
  ads,
}: HomeViewProps) {
  const items = feed.items
  const sponsoredAt = Math.min(9, items.length)
  const from = items.length === 0 ? 0 : (feed.page - 1) * feed.pageSize + 1
  const to = items.length === 0 ? 0 : from + items.length - 1
  const fresh = items.filter((i) => {
    const c = i.chapters[0]
    return c ? chapterAccess(c, user, now, overrides).isNew : false
  }).length
  const tabs: ReadonlyArray<{ type?: SeriesTypeValue; label: string }> = [
    { label: messages.discovery.all },
    { type: 'manhwa', label: messages.series.type.manhwa },
    { type: 'manga', label: messages.series.type.manga },
    { type: 'manhua', label: messages.series.type.manhua },
  ]

  return (
    <div className="container-page flex flex-col gap-5 py-5 pb-10">
      <h1 className="sr-only">{messages.site.tagline}</h1>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-1 px-3 py-2.5">
        <nav aria-label={messages.browse.type} className="flex min-w-0 flex-wrap gap-1.5">
          {tabs.map((t) => {
            const active = (t.type ?? undefined) === params.type
            return (
              <Link
                key={t.label}
                href={homeHref({ type: t.type })}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 items-center rounded-md px-3 text-[13px] font-semibold transition-colors',
                  active
                    ? 'bg-brand text-brand-ink'
                    : 'border border-line text-fg-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>
        <span className="text-[12.5px] tabular-nums text-fg-subtle">
          {fmt(messages.layouts.showingOf, { from, to, total: feed.total })}
        </span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-5">
          {genres.length > 0 ? (
            <section aria-labelledby="facet-genres" className="flex flex-col gap-2">
              <h2 id="facet-genres" className={cn(facetTitle, 'm-0')}>
                {messages.series.genres}
              </h2>
              <ul className="m-0 flex list-none flex-col p-0">
                {genres.slice(0, 14).map((g) => (
                  <li key={g.id}>
                    <Link
                      href={g.href}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                    >
                      <span className="min-w-0 truncate">{g.name}</span>
                      <span className="shrink-0 tabular-nums text-[12px] text-fg-subtle">
                        {g.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {trending.length > 0 ? (
            <section aria-labelledby="facet-trending" className="flex flex-col gap-2">
              <h2 id="facet-trending" className={cn(facetTitle, 'm-0')}>
                {messages.layouts.trendingNow}
              </h2>
              <ol className="m-0 flex list-none flex-col p-0">
                {trending.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <Link
                      href={s.href}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-surface-2"
                    >
                      <span className="w-4 shrink-0 tabular-nums text-[12px] font-bold text-fg-subtle">
                        {s.rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-fg-muted">{s.title}</span>
                      <Rating value={s.rating} count={s.ratingCount} />
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {ads.sidebar.show ? (
            <div className="hidden lg:block">
              <AdSlot
                slot="home_sidebar"
                label={messages.ads.mpu}
                width={300}
                height={250}
                placeholder={ads.sidebar.placeholder}
                tag={ads.sidebar.tag}
                className="lg:mx-0"
              />
            </div>
          ) : null}
          <AnnouncementCard announcement={announcement} />
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          {ads.top.show ? (
            <>
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
            </>
          ) : null}

          {resume.length > 0 ? <ContinueReading items={resume} /> : null}

          {sections.latest ? (
            <section aria-labelledby="catalog-title" className="flex min-w-0 flex-col gap-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line pb-2.5">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <h2
                    id="catalog-title"
                    className="m-0 font-display text-[20px] font-extrabold tracking-[-0.01em] text-fg"
                  >
                    {messages.home.latestUpdates}
                  </h2>
                  {fresh > 0 ? (
                    <span className="inline-flex h-5 items-center rounded-sm bg-brand-wash px-2 text-[11px] font-bold text-brand-hover">
                      {fmt(messages.layouts.newCount, { n: fresh })}
                    </span>
                  ) : null}
                </div>
                <span className="text-[12.5px] text-fg-subtle">
                  {messages.layouts.sortedByLatest}
                </span>
              </div>

              {items.length === 0 ? (
                <p className="m-0 py-6 text-[14px] text-fg-muted">{messages.home.emptyUpdates}</p>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {items.map((item, i) => (
                    <div key={item.id} className="contents">
                      {i === sponsoredAt && ads.infeed.show ? (
                        <div className="min-w-0">
                          <SponsoredCard placeholder={ads.infeed.placeholder} />
                        </div>
                      ) : null}
                      <CatalogCard
                        item={item}
                        user={user}
                        now={now}
                        overrides={overrides}
                        priority={i < 5}
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

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <span className="text-[12.5px] tabular-nums text-fg-subtle">
                  {fmt(messages.layouts.showingOf, { from, to, total: feed.total })}
                </span>
                <Pagination
                  page={feed.page}
                  totalPages={feed.totalPages}
                  href={(p) => homeHref({ ...params, page: p })}
                />
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
