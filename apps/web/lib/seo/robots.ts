import type { SeoSettings } from './settings'

/**
 * robots.txt (docs/12 §5 & §8): the generated default, or the admin's custom text, plus the
 * "Disallow AI crawlers" preset and the sitemap line (custom sitemap URL when set).
 */

export const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'CCBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Bytespider',
  'Google-Extended',
  'Applebot-Extended',
  'PerplexityBot',
  'Amazonbot',
  'meta-externalagent',
  'FacebookBot',
  'cohere-ai',
  'Diffbot',
  'omgili',
] as const

export const DEFAULT_ROBOTS = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /api/',
  'Disallow: /admin/',
  'Disallow: /me/',
  'Disallow: /search',
  'Disallow: /login',
  'Disallow: /register',
  'Disallow: /*?*sort=',
  'Disallow: /*?*genre=',
  'Disallow: /*?*exclude=',
].join('\n')

export const aiCrawlerBlock = (): string =>
  AI_CRAWLERS.map((ua) => `User-agent: ${ua}\nDisallow: /`).join('\n\n')

export const sitemapUrlFor = (settings: SeoSettings, origin: string): string | null => {
  if (!settings.sitemap.enabled) return null
  return settings.sitemap.custom_url ?? `${origin.replace(/\/$/, '')}/sitemap.xml`
}

export function robotsTxt(settings: SeoSettings, origin: string): string {
  const body = (settings.robots.custom?.trim() || DEFAULT_ROBOTS).replace(/\r\n/g, '\n')
  const parts = [body]
  if (settings.robots.disallow_ai) parts.push(aiCrawlerBlock())
  const sitemap = sitemapUrlFor(settings, origin)
  if (sitemap && !/^sitemap:/im.test(body)) parts.push(`Sitemap: ${sitemap}`)
  return `${parts.join('\n\n').trim()}\n`
}
