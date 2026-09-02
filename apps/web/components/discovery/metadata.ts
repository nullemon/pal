import { renderSeo, type SeoPageType, type SeoTemplate, type TemplateVars } from '@palscans/core'
import type { Metadata } from 'next'
import { getEnv } from '@/lib/env'
import { cachedSeo } from './cached'

export interface PageMetadataOptions {
  /** Path for the canonical URL, e.g. `/genres/action`. */
  path: string
  /** Force `noindex,follow` (search, filtered browse, docs/12 §7). */
  noindex?: boolean
  /** Per-entity overrides (`genres.seo_title` / `seo_description`). */
  override?: Partial<SeoTemplate>
  /** Absolute or site-relative OG image. */
  image?: string
}

/**
 * Metadata from the docs/12 templates: defaults in @palscans/core, admin overrides in the
 * `seo_settings.templates` row, and per-entity overrides on top. Titles are absolute so the
 * root layout's `%s · PALScans` template does not double the site name.
 */
export async function pageMetadata(
  page: SeoPageType,
  vars: TemplateVars,
  opts: PageMetadataOptions,
): Promise<Metadata> {
  const env = getEnv()
  const seo = await cachedSeo()
  const site = seo.identity.site_name
  const rendered = renderSeo(page, { site, ...vars }, { [page]: seo.templates[page] ?? {} })
  const title = opts.override?.title?.trim() || rendered.title
  const description =
    opts.override?.description?.trim() || rendered.description || seo.identity.default_description
  const url = new URL(opts.path, env.SITE_URL).toString()
  const noindex = opts.noindex === true || !seo.indexing.site
  const image = opts.image ? new URL(opts.image, env.SITE_URL).toString() : undefined
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      title,
      description,
      url,
      siteName: site,
      type: 'website',
      ...(image ? { images: [{ url: image, width: 400, height: 600 }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(seo.identity.x_handle ? { site: seo.identity.x_handle } : {}),
    },
  }
}

export const siteUrl = (path: string): string => new URL(path, getEnv().SITE_URL).toString()
