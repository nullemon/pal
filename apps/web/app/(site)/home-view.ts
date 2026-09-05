import { copyFn } from '@palscans/core/copy'
import { pageWindow } from '@palscans/core/pagination'
import {
  cachedAds,
  cachedAnnouncement,
  cachedGenres,
  cachedHero,
  cachedHomeLayout,
  cachedLatestTotal,
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
import { siteCopySettings } from '@/lib/copy/settings'
import { entitlementGate } from '@/lib/entitlements'

/**
 * Everything any home direction needs, loaded once (docs/17 §F — the layouts "share the same
 * data helpers"). The page dispatches on `settings.layouts.home`; no layout re-queries.
 */
export async function loadHomeView(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<HomeViewProps & { layout: string }> {
  const params = homeParamsSchema.parse(searchParams)
  const [user, layout, ads, gate, selected, appearanceCopy, feedTotal] = await Promise.all([
    getSessionUser(),
    cachedHomeLayout(),
    cachedAds(),
    entitlementGate(),
    cachedLayoutsSetting(),
    siteCopySettings(),
    cachedLatestTotal(params.type),
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

  /**
   * Clamp `?page=` here, against a count that does not depend on it, rather than inside the
   * feed query. `cachedLatestUpdates` keys on its arguments, so an unclamped page number is
   * a cache entry of its own — `homeParamsSchema` accepts ten thousand of them and the type
   * tabs multiply that by four, each entry a cold count-and-sort (measured: 80 ms at 50k
   * series) for a page with nothing on it. Clamped, every out-of-range page is the last real
   * page: one render, one key, same as `/browse` has always done.
   */
  const feedPageSize = Math.min(60, Math.max(1, sLatest.count))
  const { page: feedPage } = pageWindow(params.page, feedTotal, feedPageSize)

  const [slides, trending, feed, popular, announcement, newest, resume, genres] = await Promise.all(
    [
      hero.enabled ? cachedHero(hero.count) : Promise.resolve([]),
      sTrending.enabled ? cachedTrending(Math.min(sTrending.count, 12)) : Promise.resolve([]),
      cachedLatestUpdates(feedPage, feedPageSize, params.type, feedTotal),
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
    // the page actually served, not the one asked for, so every link a layout builds from
    // these params points at a page that exists
    params: { ...params, page: feedPage },
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
    copy: copyFn(appearanceCopy.copy),
    formatting: appearanceCopy.formatting,
    sections: { latest: sLatest.enabled },
    ads: { top: place('home_top'), sidebar: place('home_sidebar'), infeed: place('home_infeed') },
  }
}
