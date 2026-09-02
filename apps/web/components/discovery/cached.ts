import type { PopularityWindow } from '@palscans/core'
import { getDb, getSeoSetting, getSetting } from '@palscans/db'
import { unstable_cache } from 'next/cache'
import type { SeriesTypeValue } from './filters'
import {
  allGenres,
  heroSlides,
  latestAnnouncement,
  latestUpdates,
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

export const cachedLatestUpdates = unstable_cache(
  (page: number, pageSize: number, type: SeriesTypeValue | undefined) =>
    latestUpdates({ page, pageSize, type }),
  ['home', 'latest'],
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
