import { fmt, messages } from '@palscans/core/messages'
import { z } from 'zod'
import { cachedAds, cachedLayoutsSetting } from '@/components/discovery/cached'
import { adSlot } from '@/components/discovery/settings'
import type { SeriesViewProps } from '@/components/series/layouts/types'
import { storageUrl } from '@/lib/comments/media'
import { COMMENT_SORTS } from '@/lib/comments/types'
import { getAppUser } from '@/lib/comments/viewer'
import { siteFormatting } from '@/lib/copy/settings'
import { entitlementGate } from '@/lib/entitlements'
import { getEnv } from '@/lib/env'
import { chapterRows, getSeries, loadRank, loadRecommended, viewerSeriesState } from './data'

const searchSchema = z.object({ sort: z.enum(COMMENT_SORTS).catch('best') })

/**
 * Everything any series direction needs, loaded once (docs/17 §F). Returns null when the
 * slug does not resolve so the page can `notFound()`.
 */
export async function loadSeriesView(
  slug: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<(SeriesViewProps & { layout: string }) | null> {
  const series = await getSeries(slug)
  if (!series) return null
  const { sort } = searchSchema.parse({
    sort: typeof searchParams.sort === 'string' ? searchParams.sort : undefined,
  })
  const env = getEnv()
  const now = new Date()
  const user = await getAppUser()
  const gate = await entitlementGate()
  const [chapters, rank, recommended, state, selected, ads, formatting] = await Promise.all([
    chapterRows(series.id, user, now, gate.overrides),
    loadRank(series.id),
    loadRecommended(series.id),
    viewerSeriesState(user, series.id),
    cachedLayoutsSetting(),
    cachedAds(),
    siteFormatting(),
  ])
  const withAds = gate.showsAds(user, now)
  const place = (id: 'series_top' | 'series_sidebar') => {
    const slot = adSlot(ads, id)
    // No placeholder for an untagged slot: `AdSlot` then renders nothing rather than a
    // grey box. The ads screen passes its own `placeholder` to preview placements.
    return { show: withAds && slot.enabled, placeholder: false, tag: slot.tag }
  }
  return {
    layout: selected.series,
    series,
    user,
    now,
    sort,
    chapters,
    rank,
    recommended,
    state,
    coverUrl: storageUrl(series.coverKey),
    coverAlt: fmt(messages.seriesDetail.coverAlt, { title: series.title }),
    canDownload: gate.can('offline', user, now),
    earlyAccessMinutes: gate.overrides.early_access_minutes,
    site: { url: env.SITE_URL, name: env.SITE_NAME },
    formatting,
    ads: { top: place('series_top'), mpu: place('series_sidebar') },
  }
}
