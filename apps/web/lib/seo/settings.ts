import { DEFAULT_SEO_TEMPLATES, type SeoPageType } from '@palscans/core'
import type { Db } from '@palscans/db'
import { getDb, getSeoSetting, seoSettings } from '@palscans/db'
import { sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { z } from 'zod'
import { SEO_KEYS, type SeoKey, SITEMAP_SECTIONS, type SitemapSection } from './keys'

export { SEO_KEYS, type SeoKey, SITEMAP_SECTIONS, type SitemapSection }

/**
 * The `seo_settings` rows (docs/12 §8–§9), one zod shape per key. Every reader goes through
 * `loadSeoSettings` (uncached, for route handlers that must see a save immediately) or
 * `cachedSeoSettings` (300s data cache, tag `settings`, for metadata and feeds). A malformed
 * row falls back field-by-field to the defaults so a bad save never breaks rendering.
 */

const nullableString = (max = 2000) => z.string().max(max).nullable().catch(null)

export const seoIdentitySchema = z.object({
  site_name: z.string().min(1).max(80).catch('PALScans'),
  separator: z.enum(['-', '·', '—', '|']).catch('-'),
  default_description: z.string().max(400).catch(DEFAULT_SEO_TEMPLATES.home.description),
  default_og_image_key: nullableString(500),
  logo_key: nullableString(500),
  x_handle: nullableString(40),
  same_as: z.array(z.string().url()).max(12).catch([]),
})
export type SeoIdentity = z.infer<typeof seoIdentitySchema>

const templateSchema = z.object({
  title: z.string().max(300).catch(''),
  description: z.string().max(600).catch(''),
})
export const seoTemplatesSchema = z.object({
  home: templateSchema.catch(DEFAULT_SEO_TEMPLATES.home),
  series: templateSchema.catch(DEFAULT_SEO_TEMPLATES.series),
  chapter: templateSchema.catch(DEFAULT_SEO_TEMPLATES.chapter),
  genre: templateSchema.catch(DEFAULT_SEO_TEMPLATES.genre),
  rankings: templateSchema.catch(DEFAULT_SEO_TEMPLATES.rankings),
  announcement: templateSchema.catch(DEFAULT_SEO_TEMPLATES.announcement),
})
export type SeoTemplates = z.infer<typeof seoTemplatesSchema>

export const seoSitemapSchema = z.object({
  enabled: z.boolean().catch(true),
  custom_url: z.string().url().nullable().catch(null),
  sections: z.array(z.enum(SITEMAP_SECTIONS)).catch([...SITEMAP_SECTIONS]),
  include_unlisted: z.boolean().catch(false),
  chapters_per_file: z.number().int().min(100).max(50_000).catch(20_000),
  indexnow_key: z
    .string()
    .regex(/^[a-zA-Z0-9-]{8,128}$/)
    .nullable()
    .catch(null),
})
export type SeoSitemap = z.infer<typeof seoSitemapSchema>

export const seoFeedsSchema = z.object({
  enabled: z.boolean().catch(true),
  custom_url: z.string().url().nullable().catch(null),
  items: z.number().int().min(5).max(200).catch(50),
  include_early_access: z.boolean().catch(false),
})
export type SeoFeeds = z.infer<typeof seoFeedsSchema>

export const seoIndexingSchema = z.object({
  site: z.boolean().catch(true),
  chapters: z.boolean().catch(true),
  profiles: z.boolean().catch(false),
  browse_filters: z.boolean().catch(false),
})
export type SeoIndexing = z.infer<typeof seoIndexingSchema>

export const seoVerificationSchema = z.object({
  google: nullableString(200),
  bing: nullableString(200),
  yandex: nullableString(200),
  pinterest: nullableString(200),
})
export type SeoVerification = z.infer<typeof seoVerificationSchema>

export const seoRobotsSchema = z.object({
  custom: z.string().max(20_000).nullable().catch(null),
  disallow_ai: z.boolean().catch(false),
})
export type SeoRobots = z.infer<typeof seoRobotsSchema>

export const seoKeySchemas = {
  identity: seoIdentitySchema,
  templates: seoTemplatesSchema,
  sitemap: seoSitemapSchema,
  feeds: seoFeedsSchema,
  indexing: seoIndexingSchema,
  verification: seoVerificationSchema,
  robots: seoRobotsSchema,
} as const

export interface SeoSettings {
  identity: SeoIdentity
  templates: SeoTemplates
  sitemap: SeoSitemap
  feeds: SeoFeeds
  indexing: SeoIndexing
  verification: SeoVerification
  robots: SeoRobots
}

/** Defaults when a row is missing entirely (the seed writes all of them). */
export const DEFAULT_SEO_SETTINGS: SeoSettings = {
  identity: seoIdentitySchema.parse({}),
  templates: seoTemplatesSchema.parse({}),
  sitemap: seoSitemapSchema.parse({}),
  feeds: seoFeedsSchema.parse({}),
  indexing: seoIndexingSchema.parse({}),
  verification: seoVerificationSchema.parse({}),
  robots: seoRobotsSchema.parse({}),
}

/** Parse one raw row value with its key's schema; never throws. */
export function parseSeoSetting<K extends SeoKey>(key: K, raw: unknown): SeoSettings[K] {
  const schema = seoKeySchemas[key]
  const result = schema.safeParse(raw ?? {})
  return (result.success ? result.data : DEFAULT_SEO_SETTINGS[key]) as SeoSettings[K]
}

export async function loadSeoSettings(db?: Db): Promise<SeoSettings> {
  const database = db ?? (await getDb())
  const raw = await Promise.all(SEO_KEYS.map((key) => getSeoSetting<unknown>(database, key, null)))
  const out = { ...DEFAULT_SEO_SETTINGS }
  SEO_KEYS.forEach((key, i) => {
    ;(out as Record<SeoKey, unknown>)[key] = parseSeoSetting(key, raw[i])
  })
  return out
}

export const SEO_CACHE_TAGS = ['settings', 'seo'] as const

/** Cached for metadata, feeds and robots; the admin save calls `revalidateTag('seo')`. */
export const cachedSeoSettings = unstable_cache(() => loadSeoSettings(), ['seo_settings', 'all'], {
  revalidate: 300,
  tags: [...SEO_CACHE_TAGS],
})

/** Upsert one key; the admin route validates `value` first. Returns the stored value. */
export async function saveSeoSetting<K extends SeoKey>(
  db: Db,
  key: K,
  value: SeoSettings[K],
  updatedBy: number,
): Promise<SeoSettings[K]> {
  await db
    .insert(seoSettings)
    .values({ key, value, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: seoSettings.key,
      set: { value, updatedBy, updatedAt: sql`now()` },
    })
  return value
}

/** The template for a page type with the admin override applied over the shipped default. */
export const templateFor = (
  settings: SeoSettings,
  page: SeoPageType,
): { title: string; description: string } => {
  const custom = settings.templates[page]
  const base = DEFAULT_SEO_TEMPLATES[page]
  return {
    title: custom.title.trim() || base.title,
    description: custom.description.trim() || base.description,
  }
}
