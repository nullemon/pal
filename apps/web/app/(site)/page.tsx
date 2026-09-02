import { showsAds } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { AdSlot, Rail, SeriesCard } from '@palscans/ui'
import { Sparkles } from 'lucide-react'
import type { Metadata } from 'next'
import {
  cachedAds,
  cachedAnnouncement,
  cachedHero,
  cachedHomeLayout,
  cachedLatestUpdates,
  cachedNewest,
  cachedPopular,
  cachedTrending,
} from '@/components/discovery/cached'
import { homeParamsSchema } from '@/components/discovery/filters'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import { pageMetadata } from '@/components/discovery/metadata'
import { continueReading } from '@/components/discovery/queries'
import { SectionTitle } from '@/components/discovery/SectionTitle'
import { uiType } from '@/components/discovery/SeriesGrid'
import { adSlot, homeSection } from '@/components/discovery/settings'
import { AnnouncementCard } from '@/components/home/AnnouncementCard'
import { ContinueReading } from '@/components/home/ContinueReading'
import { Hero } from '@/components/home/Hero'
import { LatestUpdates } from '@/components/home/LatestUpdates'
import { PopularSidebar } from '@/components/home/PopularSidebar'
import { TrendingRail } from '@/components/home/TrendingRail'
import { getSessionUser } from '@/lib/auth/session'

/**
 * Home — layout A (design/mockups/A/Main.dc.html). The page personalises (Continue reading,
 * ad-free), so it renders per request; every catalogue query behind it is served from the
 * 60s data cache in components/discovery/cached.ts (docs/06 "static shell + dynamic holes").
 */
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata('home', {}, { path: '/' })
}

export default async function HomePage({ searchParams }: PageProps<'/'>) {
  const params = homeParamsSchema.parse(await searchParams)
  const [user, layout, ads] = await Promise.all([getSessionUser(), cachedHomeLayout(), cachedAds()])
  const now = new Date()
  const withAds = showsAds(user, now)

  const hero = layout.hero
  const sContinue = homeSection(layout, 'continue')
  const sTrending = homeSection(layout, 'trending')
  const sLatest = homeSection(layout, 'latest')
  const sPopular = homeSection(layout, 'popular')
  const sNewest = homeSection(layout, 'recently_added')
  const sAnnouncements = homeSection(layout, 'announcements')

  const [slides, trending, feed, popular, announcement, newest, resume] = await Promise.all([
    hero.enabled ? cachedHero(hero.count) : Promise.resolve([]),
    sTrending.enabled ? cachedTrending(Math.min(sTrending.count, 12)) : Promise.resolve([]),
    cachedLatestUpdates(params.page, sLatest.count, params.type),
    sPopular.enabled ? cachedPopular(sPopular.count) : Promise.resolve(null),
    sAnnouncements.enabled ? cachedAnnouncement() : Promise.resolve(null),
    sNewest.enabled ? cachedNewest(sNewest.count) : Promise.resolve([]),
    user && sContinue.enabled ? continueReading(user.id, sContinue.count) : Promise.resolve([]),
  ])

  const top = adSlot(ads, 'home_top')
  const sidebar = adSlot(ads, 'home_sidebar')
  const infeed = adSlot(ads, 'home_infeed')

  return (
    <div className="flex flex-col gap-4 pb-6">
      <h1 className="sr-only">{messages.site.tagline}</h1>
      <Hero slides={slides} />

      <div className="container-page flex flex-col gap-5">
        {top.enabled ? (
          <div className="py-1">
            <div className="hidden md:block">
              <AdSlot
                slot="home_top"
                label={messages.ads.leaderboard}
                width={970}
                height={90}
                noAds={!withAds}
                placeholder={top.tag === null}
              />
            </div>
            <div className="md:hidden">
              <AdSlot
                slot="home_top"
                label={messages.ads.leaderboard}
                width={320}
                height={100}
                noAds={!withAds}
                placeholder={top.tag === null}
              />
            </div>
          </div>
        ) : null}

        <ContinueReading items={resume} />
        <TrendingRail items={trending} />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {sLatest.enabled ? (
            <LatestUpdates
              feed={feed}
              type={params.type}
              user={user}
              now={now}
              sponsored={withAds && infeed.enabled ? { placeholder: infeed.tag === null } : null}
            />
          ) : (
            <div />
          )}
          <aside className="flex flex-col gap-2.5">
            {popular ? <PopularSidebar lists={popular} /> : null}
            {sidebar.enabled ? (
              <div className="hidden lg:block">
                <AdSlot
                  slot="home_sidebar"
                  label={messages.ads.mpu}
                  width={300}
                  height={250}
                  noAds={!withAds}
                  placeholder={sidebar.tag === null}
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
