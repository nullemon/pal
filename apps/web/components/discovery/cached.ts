import type { PopularityWindow } from '@palscans/core'
import { getDb, getSeoSetting, getSetting } from '@palscans/db'
import { unstable_cache } from 'next/cache'
import type { SeriesTypeValue } from './filters'
import {
  allGenres,
  type BrowseFilters,
  type BrowseQuery,
  browseSeries,
  browseTotal,
  heroSlides,
  latestAnnouncement,
  latestUpdates,
  latestUpdatesTotal,
  newestSeries,
  popularLists,
  rankedSeries,
  search,
} from './queries'
import {
  type AdsSettings,
  adsSettingsSchema,
  DEFAULT_ADS,
  DEFAULT_HOME_LAYOUT,
  type HomeLayout,
  homeLayoutSchema,
  type SeoIdentity,
  type SeoIndexing,
  type SeoTemplates,
  seoIdentitySchema,
  seoIndexingSchema,
  seoTemplatesSchema,
} from './settings'

/**
 * Data cache for the discovery surfaces (docs/06 "Rendering strategy"): the home page is
 * rendered per request because it personalises (Continue reading, ad-free), so the
 * catalogue queries behind it are cached for 60s here instead of at the HTML layer.
 * Genre and rankings data live for 300s. Publishing can purge with
 * `revalidateTag('catalog')`.
 */
export const HOME_REVALIDATE = 60
export const CATALOG_REVALIDATE = 300

const CATALOG = ['catalog']
const SETTINGS = ['settings']

export const cachedHomeLayout = unstable_cache(
  async (): Promise<HomeLayout> => {
    const raw = await getSetting<unknown>(await getDb(), 'home_layout', null)
    const parsed = homeLayoutSchema.safeParse(raw)
    return parsed.success ? parsed.data : DEFAULT_HOME_LAYOUT
  },
  ['settings', 'home_layout'],
  { revalidate: HOME_REVALIDATE, tags: SETTINGS },
)

export const cachedAds = unstable_cache(
  async (): Promise<AdsSettings> => {
    const raw = await getSetting<unknown>(await getDb(), 'ads', null)
    const parsed = adsSettingsSchema.safeParse(raw)
    return parsed.success ? parsed.data : DEFAULT_ADS
  },
  ['settings', 'ads'],
  { revalidate: HOME_REVALIDATE, tags: SETTINGS },
)

export interface SeoSettings {
  identity: SeoIdentity
  templates: SeoTemplates
  indexing: SeoIndexing
}

export const cachedSeo = unstable_cache(
  async (): Promise<SeoSettings> => {
    const db = await getDb()
    const [identity, templates, indexing] = await Promise.all([
      getSeoSetting<unknown>(db, 'identity', null),
      getSeoSetting<unknown>(db, 'templates', null),
      getSeoSetting<unknown>(db, 'indexing', null),
    ])
    const id = seoIdentitySchema.safeParse(identity ?? {})
    const tpl = seoTemplatesSchema.safeParse(templates ?? {})
    const idx = seoIndexingSchema.safeParse(indexing ?? {})
    return {
      identity: id.success ? id.data : seoIdentitySchema.parse({}),
      templates: tpl.success ? tpl.data : {},
      indexing: idx.success ? idx.data : seoIndexingSchema.parse({}),
    }
  },
  ['seo_settings'],
  { revalidate: CATALOG_REVALIDATE, tags: SETTINGS },
)

export const cachedHero = unstable_cache((limit: number) => heroSlides(limit), ['home', 'hero'], {
  revalidate: HOME_REVALIDATE,
  tags: CATALOG,
})

export const cachedTrending = unstable_cache(
  (limit: number) => rankedSeries('weekly', limit),
  ['home', 'trending'],
  { revalidate: HOME_REVALIDATE, tags: CATALOG },
)

/**
 * How many rows the latest-updates feed has, per type tab — five keys, no page in sight.
 * The caller clamps `?page=` against it *before* calling `cachedLatestUpdates`, whose key is
 * its argument list: without the clamp, `/?page=9999` is a cache entry of its own, and the
 * ten thousand values the parameter accepts are forty thousand of them across the four tabs,
 * every one a cold count-and-sort for a page with nothing on it.
 */
export const cachedLatestTotal = unstable_cache(
  (type: SeriesTypeValue | undefined) => latestUpdatesTotal(type),
  ['home', 'latest', 'total'],
  { revalidate: HOME_REVALIDATE, tags: CATALOG },
)

export const cachedLatestUpdates = unstable_cache(
  (page: number, pageSize: number, type: SeriesTypeValue | undefined, total?: number) =>
    latestUpdates({ page, pageSize, type, total }),
  ['home', 'latest'],
  { revalidate: HOME_REVALIDATE, tags: CATALOG },
)

/**
 * `/browse` and `/genres/[slug]`, on the same 60s data cache as the home page (docs/06
 * "static shell + dynamic holes").
 *
 * Three of the four sorts are a sequential scan over every published series and always will
 * be: `popular` orders by `view_count`, which `stats_rollup` rewrites every two minutes, so
 * an index on it would turn each of those updates into a non-HOT one and re-insert the row
 * into both GIN indexes on `series` for nothing; and `rating` orders by a Bayesian score
 * whose prior is the site-wide mean, computed per request — not a constant, so not
 * indexable at all. Measured on a 50k seed: popular 26.7 ms, rating 28.8 ms (plus 27.4 ms
 * for the mean), newest 26.1 ms, title 34.3 ms, and the page had no cache and no
 * `revalidate` at all, so every visitor paid it. A trial index made the unfiltered popular
 * sort 0.1 ms and one filtered shape 50 ms against 14 ms without it — it moves the cost, it
 * does not remove it. The cache removes it for every sort at once, including the `count(*)`
 * and the rating mean, which no index touches.
 */
export const cachedBrowseTotal = unstable_cache(
  (filters: BrowseFilters) => browseTotal(filters),
  ['browse', 'total'],
  { revalidate: HOME_REVALIDATE, tags: CATALOG },
)

export const cachedBrowse = unstable_cache(
  (q: BrowseQuery) => browseSeries(q),
  ['browse', 'page'],
  { revalidate: HOME_REVALIDATE, tags: CATALOG },
)

export const cachedPopular = unstable_cache(
  (limit: number) => popularLists(limit),
  ['home', 'popular'],
  {
    revalidate: CATALOG_REVALIDATE,
    tags: CATALOG,
  },
)

export const cachedAnnouncement = unstable_cache(
  () => latestAnnouncement(),
  ['home', 'announcement'],
  {
    revalidate: HOME_REVALIDATE,
    tags: CATALOG,
  },
)

export const cachedNewest = unstable_cache(
  (limit: number) => newestSeries(limit),
  ['home', 'newest'],
  {
    revalidate: HOME_REVALIDATE,
    tags: CATALOG,
  },
)

export const cachedRankings = unstable_cache(
  (window: PopularityWindow, limit: number) => rankedSeries(window, limit),
  ['rankings'],
  { revalidate: CATALOG_REVALIDATE, tags: CATALOG },
)

export const cachedGenres = unstable_cache(() => allGenres(), ['genres', 'index'], {
  revalidate: CATALOG_REVALIDATE,
  tags: CATALOG,
})

/** Search results cached per normalised query for 60s (docs/06: "Redis-cached by query"). */
export const cachedSearch = unstable_cache((q: string) => search(q), ['search'], {
  revalidate: HOME_REVALIDATE,
  tags: CATALOG,
})

/**
 * `settings.layouts` — which direction each surface renders (docs/17 §F). Read through the
 * same 60s settings cache as the rest, so an Appearance → Layouts save takes effect at once
 * via `revalidateTag('settings')`.
 */
export const cachedLayoutsSetting = unstable_cache(
  async (): Promise<{ home: string; series: string }> => {
    const raw = await getSetting<{ home?: unknown; series?: unknown }>(await getDb(), 'layouts', {})
    const pick = (v: unknown) => (typeof v === 'string' ? v : '')
    return { home: pick(raw?.home), series: pick(raw?.series) }
  },
  ['settings', 'layouts'],
  { revalidate: HOME_REVALIDATE, tags: SETTINGS },
)
