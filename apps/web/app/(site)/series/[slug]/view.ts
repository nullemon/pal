import { fmt, messages } from '@palscans/core/messages'
import { z } from 'zod'
import { cachedLayoutsSetting } from '@/components/discovery/cached'
import type { SeriesViewProps } from '@/components/series/layouts/types'
import { storageUrl } from '@/lib/comments/media'
import { COMMENT_SORTS } from '@/lib/comments/types'
import { getAppUser } from '@/lib/comments/viewer'
import { entitlementGate } from '@/lib/entitlements'
import { getEnv } from '@/lib/env'
import { chapterRows, getSeries, loadRank, loadRecommended, viewerSeriesState } from './data'

const searchSchema = z.object({ sort: z.enum(COMMENT_SORTS).catch('best') })

/** `AdSlot`'s own default: the dashed placeholder outside production, nothing in it. */
const AD_PLACEHOLDER = process.env.NODE_ENV !== 'production'

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
  const [chapters, rank, recommended, state, selected] = await Promise.all([
    chapterRows(series.id, user, now, gate.overrides),
    loadRank(series.id),
    loadRecommended(series.id),
    viewerSeriesState(user, series.id),
    cachedLayoutsSetting(),
  ])
  const show = gate.showsAds(user, now)
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
    ads: {
      top: { show, placeholder: AD_PLACEHOLDER },
      mpu: { show, placeholder: AD_PLACEHOLDER },
    },
  }
}
