import { renderTemplate, type SeoPageType, type TemplateVars, truncateWords } from '@palscans/core'
import type { Metadata } from 'next'
import { getEnv } from '../env'
import { cachedSeoSettings, type SeoSettings, templateFor } from './settings'
import { absoluteUrl, storagePublicUrl } from './urls'

/**
 * Per-page metadata (docs/12 §2, §7): title/description from the admin-editable templates,
 * canonical, Open Graph, Twitter card, robots from the visibility rules, verification tags,
 * feed alternates and prev/next. `metadataFor` is pure (unit-tested); `buildMetadata` is
 * what pages call — it reads the cached seo_settings.
 */

/** Template-driven page types plus the static ones that only carry a title. */
export type MetadataPageType =
  | SeoPageType
  | 'page'
  | 'browse'
  | 'search'
  | 'profile'
  | 'announcements'

export interface MetadataContext {
  /** Site-relative path of the page, e.g. `/series/solo-leveling`. */
  path: string
  /** Variables for the docs/12 template (`{title}`, `{chapter}` …). `{site}` is filled in. */
  vars?: TemplateVars
  /** Per-entity overrides (series.seo_title, genres.seo_description …) win over templates. */
  override?: { title?: string | null; description?: string | null }
  /** Per-series canonical override (a title mirrored from a primary URL). */
  canonical?: string | null
  /** Per-series noindex, or a forced noindex (search, filtered browse). */
  noindex?: boolean
  /** OG image — absolute URL or site path. Falls back to the default OG image. */
  image?: string | null
  imageAlt?: string
  imageWidth?: number
  imageHeight?: number
  ogType?: 'website' | 'article'
  /** Feed path for `<link rel="alternate">`; the custom feed URL replaces it when set. */
  feed?: string | null
  /** Chapter pages: prev / next links. */
  prev?: string | null
  next?: string | null
  /** Browse with filters (docs/12 §7 "Index browse with filters"). */
  hasFilters?: boolean
}

const TEMPLATED: readonly MetadataPageType[] = [
  'home',
  'series',
  'chapter',
  'genre',
  'rankings',
  'announcement',
]

const isTemplated = (page: MetadataPageType): page is SeoPageType => TEMPLATED.includes(page)

/** Whether robots should index this page under the docs/12 §7 rules. */
export function isIndexable(
  settings: SeoSettings,
  page: MetadataPageType,
  ctx: Pick<MetadataContext, 'noindex' | 'hasFilters'>,
): boolean {
  const rules = settings.indexing
  if (!rules.site) return false
  if (ctx.noindex) return false
  if (page === 'search') return false
  if (page === 'chapter' && !rules.chapters) return false
  if (page === 'profile' && !rules.profiles) return false
  if (page === 'browse' && ctx.hasFilters && !rules.browse_filters) return false
  return true
}

export interface MetadataEnv {
  siteUrl: string
  defaultOgImage?: string | null
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

export function metadataFor(
  settings: SeoSettings,
  env: MetadataEnv,
  page: MetadataPageType,
  ctx: MetadataContext,
): Metadata {
  const site = settings.identity.site_name
  const sep = settings.identity.separator
  const vars: TemplateVars = { site, ...(ctx.vars ?? {}) }

  let title = ''
  let description = ''
  if (isTemplated(page)) {
    const template = templateFor(settings, page)
    title = renderTemplate(template.title, vars)
    description = renderTemplate(template.description, vars)
  }
  const overrideTitle = ctx.override?.title?.trim()
  const overrideDescription = ctx.override?.description?.trim()
  if (overrideTitle) title = isTemplated(page) ? overrideTitle : `${overrideTitle} ${sep} ${site}`
  if (!title) title = site
  if (overrideDescription) description = overrideDescription
  if (!description) description = settings.identity.default_description
  title = clean(title)
  description = truncateWords(clean(description), 300)

  const origin = new URL(env.siteUrl).origin
  const canonical = ctx.canonical?.trim() || absoluteUrl(ctx.path, origin)
  const indexable = isIndexable(settings, page, ctx)
  const image = ctx.image
    ? absoluteUrl(ctx.image, origin)
    : env.defaultOgImage
      ? absoluteUrl(env.defaultOgImage, origin)
      : undefined

  const feedsOn = settings.feeds.enabled && !!ctx.feed
  const builtIn = ctx.feed ? absoluteUrl(ctx.feed, origin) : ''
  const feedUrl = feedsOn ? (settings.feeds.custom_url ?? builtIn) : null
  const atomUrl = feedsOn && !settings.feeds.custom_url ? `${builtIn}?format=atom` : null

  const meta: Metadata = {
    title: { absolute: title },
    description,
    alternates: {
      canonical,
      ...(feedUrl
        ? {
            types: {
              'application/rss+xml': [{ url: feedUrl, title: `${site} RSS` }],
              ...(atomUrl
                ? { 'application/atom+xml': [{ url: atomUrl, title: `${site} Atom` }] }
                : {}),
            },
          }
        : {}),
    },
    robots: indexable
      ? { index: true, follow: true, 'max-image-preview': 'large' }
      : { index: false, follow: true },
    openGraph: {
      type: ctx.ogType ?? (page === 'announcement' || page === 'chapter' ? 'article' : 'website'),
      siteName: site,
      title,
      description,
      url: canonical,
      ...(image
        ? {
            images: [
              {
                url: image,
                alt: ctx.imageAlt ?? title,
                ...(ctx.imageWidth ? { width: ctx.imageWidth } : {}),
                ...(ctx.imageHeight ? { height: ctx.imageHeight } : {}),
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(settings.identity.x_handle ? { site: settings.identity.x_handle } : {}),
      ...(image ? { images: [image] } : {}),
    },
  }
  const verification = verificationMeta(settings)
  if (verification) meta.verification = verification
  if (ctx.prev || ctx.next) {
    meta.pagination = {
      ...(ctx.prev ? { previous: absoluteUrl(ctx.prev, origin) } : {}),
      ...(ctx.next ? { next: absoluteUrl(ctx.next, origin) } : {}),
    }
  }
  return meta
}

/** Search-engine verification tags (docs/12 §8), rendered on every page that uses buildMetadata. */
export function verificationMeta(settings: SeoSettings): Metadata['verification'] | undefined {
  const v = settings.verification
  const other: Record<string, string> = {}
  if (v.bing) other['msvalidate.01'] = v.bing
  if (v.pinterest) other['p:domain_verify'] = v.pinterest
  if (!v.google && !v.yandex && Object.keys(other).length === 0) return undefined
  return {
    ...(v.google ? { google: v.google } : {}),
    ...(v.yandex ? { yandex: v.yandex } : {}),
    ...(Object.keys(other).length ? { other } : {}),
  }
}

/** The helper other pages call from `generateMetadata`. */
export async function buildMetadata(
  page: MetadataPageType,
  ctx: MetadataContext,
): Promise<Metadata> {
  const settings = await cachedSeoSettings()
  const env = getEnv()
  return metadataFor(
    settings,
    {
      siteUrl: env.SITE_URL,
      defaultOgImage: storagePublicUrl(settings.identity.default_og_image_key),
    },
    page,
    ctx,
  )
}
