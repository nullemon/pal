import { DEFAULT_SEO_TEMPLATES } from '@palscans/core'
import { z } from 'zod'

/**
 * zod shapes for the admin-edited JSON rows this scope reads (`settings.home_layout`,
 * `settings.ads`, `seo_settings.*`). Unknown or malformed values fall back to the defaults
 * so a bad admin save never breaks the home page.
 */
export const homeSectionSchema = z.object({
  id: z.string(),
  enabled: z.boolean().catch(true),
  title: z.string().optional(),
  count: z.number().int().min(1).max(100).catch(12),
})

export const homeLayoutSchema = z.object({
  hero: z
    .object({
      enabled: z.boolean().catch(true),
      style: z.string().catch('carousel'),
      count: z.number().int().min(1).max(12).catch(6),
    })
    .catch({ enabled: true, style: 'carousel', count: 6 }),
  sections: z.array(homeSectionSchema).catch([]),
})
export type HomeLayout = z.infer<typeof homeLayoutSchema>

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  hero: { enabled: true, style: 'carousel', count: 6 },
  sections: [
    { id: 'continue', enabled: true, title: 'Continue reading', count: 8 },
    { id: 'trending', enabled: true, title: 'Trending', count: 12 },
    { id: 'latest', enabled: true, title: 'Latest updates', count: 20 },
    { id: 'popular', enabled: true, title: 'Popular', count: 10 },
    { id: 'recently_added', enabled: true, title: 'Recently added', count: 12 },
    { id: 'recently_completed', enabled: false, title: 'Recently completed', count: 12 },
    { id: 'announcements', enabled: true, title: 'Announcements', count: 1 },
  ],
}

export function homeSection(layout: HomeLayout, id: string) {
  const fromDb = layout.sections.find((s) => s.id === id)
  const fallback = DEFAULT_HOME_LAYOUT.sections.find((s) => s.id === id)
  return fromDb ?? fallback ?? { id, enabled: true, count: 12 }
}

const adSlotSchema = z
  .object({ enabled: z.boolean().catch(true), tag: z.string().nullable().catch(null) })
  .catch({ enabled: true, tag: null })

export const adsSettingsSchema = z.object({
  slots: z
    .object({
      home_top: adSlotSchema,
      home_sidebar: adSlotSchema,
      home_infeed: adSlotSchema,
    })
    .partial()
    .catch({}),
})
export type AdsSettings = z.infer<typeof adsSettingsSchema>

export const DEFAULT_ADS: AdsSettings = { slots: {} }

export type HomeAdSlot = 'home_top' | 'home_sidebar' | 'home_infeed'

export function adSlot(ads: AdsSettings, id: HomeAdSlot): { enabled: boolean; tag: string | null } {
  return ads.slots[id] ?? { enabled: true, tag: null }
}

const templateSchema = z.object({ title: z.string(), description: z.string() }).partial()

export const seoTemplatesSchema = z
  .object({
    home: templateSchema,
    series: templateSchema,
    chapter: templateSchema,
    genre: templateSchema,
    rankings: templateSchema,
    announcement: templateSchema,
  })
  .partial()
export type SeoTemplates = z.infer<typeof seoTemplatesSchema>

export const seoIdentitySchema = z.object({
  site_name: z.string().min(1).catch('PALScans'),
  separator: z.string().catch('·'),
  default_description: z.string().catch(DEFAULT_SEO_TEMPLATES.home.description),
  default_og_image_key: z.string().nullable().catch(null),
  x_handle: z.string().nullable().catch(null),
})
export type SeoIdentity = z.infer<typeof seoIdentitySchema>

export const seoIndexingSchema = z.object({
  site: z.boolean().catch(true),
  chapters: z.boolean().catch(true),
  profiles: z.boolean().catch(false),
  browse_filters: z.boolean().catch(false),
})
export type SeoIndexing = z.infer<typeof seoIndexingSchema>
