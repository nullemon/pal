import { messages } from '@palscans/core/messages'
import { AdSlot, Rail, SeriesCard } from '@palscans/ui'
import { Sparkles } from 'lucide-react'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import { SectionTitle } from '@/components/discovery/SectionTitle'
import { uiType } from '@/components/discovery/SeriesGrid'
import { AnnouncementCard } from '@/components/home/AnnouncementCard'
import { ContinueReading } from '@/components/home/ContinueReading'
import { Hero } from '@/components/home/Hero'
import { LatestUpdates } from '@/components/home/LatestUpdates'
import { PopularSidebar } from '@/components/home/PopularSidebar'
import { TrendingRail } from '@/components/home/TrendingRail'
import type { HomeViewProps } from './types'

/**
 * Home layout **A · Violet Classic** (design/mockups/A/Main.dc.html) — the shipping default.
 * Presentational: every row it draws comes from `loadHomeView()`.
 */
export function HomeA({
  params,
  user,
  now,
  overrides,
  slides,
  trending,
  feed,
  popular,
  announcement,
  newest,
  resume,
  sections,
  ads,
}: HomeViewProps) {
  return (
    <div className="flex flex-col gap-4 pb-6">
      <h1 className="sr-only">{messages.site.tagline}</h1>
      <Hero slides={slides} />

      <div className="container-page flex flex-col gap-5">
        {ads.top.show ? (
          <div className="py-1">
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

        <ContinueReading items={resume} />
        <TrendingRail items={trending} />

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
          <aside className="flex flex-col gap-2.5">
            {popular ? <PopularSidebar lists={popular} /> : null}
            {ads.sidebar.show ? (
              <div className="hidden lg:block">
                <AdSlot
                  slot="home_sidebar"
                  label={messages.ads.mpu}
                  width={300}
                  height={250}
                  placeholder={ads.sidebar.placeholder}
                  tag={ads.sidebar.tag}
                />
              </div>
            ) : null}
            <AnnouncementCard announcement={announcement} />
          </aside>
        </div>

        {newest.length > 0 ? (
          <section aria-labelledby="newest-title" className="flex flex-col gap-2">
            <SectionTitle
              id="newest-title"
              title={messages.home.recentlyAdded}
              icon={<Sparkles size={18} />}
              link={{ href: '/browse?sort=newest', label: messages.home.viewAll }}
            />
            <Rail label={messages.home.recentlyAdded} itemWidth="140px">
              {newest.map((s) => (
                <SeriesCard
                  key={s.id}
                  title={s.title}
                  href={s.href}
                  cover={{
                    src: s.coverSrc,
                    width: COVER_WIDTH,
                    height: COVER_HEIGHT,
                    alt: `${s.title} cover`,
                  }}
                  type={uiType(s.type)}
                  rating={s.ratingCount > 0 ? s.rating : undefined}
                  latestChapter={{ number: s.chapterCount }}
                />
              ))}
            </Rail>
          </section>
        ) : null}
      </div>
    </div>
  )
}
