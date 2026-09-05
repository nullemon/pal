import {
  cachedAds,
  cachedAnnouncement,
  cachedGenres,
  cachedHero,
  cachedHomeLayout,
  cachedLatestUpdates,
  cachedLayoutsSetting,
  cachedNewest,
  cachedPopular,
  cachedTrending,
} from '@/components/discovery/cached'
import { homeParamsSchema } from '@/components/discovery/filters'
import { continueReading } from '@/components/discovery/queries'
import { adSlot, homeSection } from '@/components/discovery/settings'
import type { HomeViewProps } from '@/components/home/layouts/types'
import { getSessionUser } from '@/lib/auth/session'
import { entitlementGate } from '@/lib/entitlements'

/**
 * Everything any home direction needs, loaded once (docs/17 §F — the layouts "share the same
 * data helpers"). The page dispatches on `settings.layouts.home`; no layout re-queries.
 */
export async function loadHomeView(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<HomeViewProps & { layout: string }> {
  const params = homeParamsSchema.parse(searchParams)
  const [user, layout, ads, gate, selected] = await Promise.all([
    getSessionUser(),
    cachedHomeLayout(),
    cachedAds(),
    entitlementGate(),
    cachedLayoutsSetting(),
  ])
  const now = new Date()
  const withAds = gate.showsAds(user, now)

  const hero = layout.hero
  const sContinue = homeSection(layout, 'continue')
  const sTrending = homeSection(layout, 'trending')
  const sLatest = homeSection(layout, 'latest')
  const sPopular = homeSection(layout, 'popular')
  const sNewest = homeSection(layout, 'recently_added')
  const sAnnouncements = homeSection(layout, 'announcements')

  const [slides, trending, feed, popular, announcement, newest, resume, genres] = await Promise.all(
    [
      hero.enabled ? cachedHero(hero.count) : Promise.resolve([]),
      sTrending.enabled ? cachedTrending(Math.min(sTrending.count, 12)) : Promise.resolve([]),
      cachedLatestUpdates(params.page, sLatest.count, params.type),
      sPopular.enabled ? cachedPopular(sPopular.count) : Promise.resolve(null),
      sAnnouncements.enabled ? cachedAnnouncement() : Promise.resolve(null),
      sNewest.enabled ? cachedNewest(sNewest.count) : Promise.resolve([]),
      user && sContinue.enabled ? continueReading(user.id, sContinue.count) : Promise.resolve([]),
      cachedGenres(),
    ],
  )

  const place = (id: 'home_top' | 'home_sidebar' | 'home_infeed') => {
    const slot = adSlot(ads, id)
    return { show: withAds && slot.enabled, placeholder: slot.tag === null, tag: slot.tag }
  }

  return {
    layout: selected.home,
    params,
    user,
    now,
    overrides: gate.overrides,
    slides,
    trending,
    feed,
    popular,
    announcement,
    newest,
    resume,
    genres,
    sections: { latest: sLatest.enabled },
    ads: { top: place('home_top'), sidebar: place('home_sidebar'), infeed: place('home_infeed') },
  }
}
