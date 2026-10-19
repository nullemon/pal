/** Small XML helpers shared by the sitemaps and feeds — every text node goes through `esc`. */

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are invalid in XML 1.0
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g

export const esc = (value: string | number): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(CONTROL, '')

export const isoDate = (d: Date | string | null | undefined): string | undefined => {
  if (!d) return undefined
  const date = d instanceof Date ? d : new Date(d)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export interface SitemapImage {
  url: string
  title?: string
}

/** One `hreflang` pairing: a language and the URL that serves it. */
export interface SitemapAlternate {
  hreflang: string
  href: string
}

export interface SitemapUrl {
  loc: string
  lastmod?: Date | string | null
  images?: SitemapImage[]
  /**
   * The other languages of this page, including itself.
   *
   * Google wants the set to be reciprocal — every URL in it listing every URL in it, this
   * one included — and treats a one-way claim as unverified and drops it. Listing them in
   * the sitemap is the cheaper half of doing that: the page's own `<head>` carries the same
   * set, and between them a translation gets indexed as a translation rather than as a
   * duplicate of the English page.
   */
  alternates?: SitemapAlternate[]
}

/** Protocol limits (docs/12 §5). */
export const SITEMAP_MAX_URLS = 50_000
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024

export function urlsetXml(urls: readonly SitemapUrl[]): string {
  const hasImages = urls.some((u) => u.images?.length)
  const hasAlternates = urls.some((u) => u.alternates?.length)
  // Namespaces only when something uses them: these files are gzipped and counted against a
  // 50 MB limit, and two unused declarations on every sitemap is bytes for nothing.
  const ns =
    (hasImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : '') +
    (hasAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : '')
  const items = urls.map((u) => {
    const lastmod = isoDate(u.lastmod)
    const alternates = (u.alternates ?? [])
      .map(
        (a) => `<xhtml:link rel="alternate" hreflang="${esc(a.hreflang)}" href="${esc(a.href)}"/>`,
      )
      .join('')
    const images = (u.images ?? [])
      .map(
        (img) =>
          `<image:image><image:loc>${esc(img.url)}</image:loc>${
            img.title ? `<image:title>${esc(img.title)}</image:title>` : ''
          }</image:image>`,
      )
      .join('')
    return `<url><loc>${esc(u.loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${alternates}${images}</url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${ns}>\n${items.join('\n')}\n</urlset>\n`
}

export interface SitemapIndexEntry {
  loc: string
  lastmod?: Date | string | null
}

export function sitemapIndexXml(entries: readonly SitemapIndexEntry[]): string {
  const items = entries.map((e) => {
    const lastmod = isoDate(e.lastmod)
    return `<sitemap><loc>${esc(e.loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</sitemap>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>\n`
}

/** Split a list into files of at most `size` entries. */
export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
