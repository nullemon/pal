/** Client-safe constants for the SEO settings (no database or Next imports). */
export const SEO_KEYS = [
  'identity',
  'templates',
  'sitemap',
  'feeds',
  'indexing',
  'verification',
  'robots',
] as const
export type SeoKey = (typeof SEO_KEYS)[number]

export const SITEMAP_SECTIONS = [
  'pages',
  'series',
  'chapters',
  'genres',
  'announcements',
  'images',
] as const
export type SitemapSection = (typeof SITEMAP_SECTIONS)[number]
