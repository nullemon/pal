import { getEnv } from '../env'
import { JsonLd } from './JsonLd'
import { graphJsonLd, organizationJsonLd, webSiteJsonLd } from './jsonld'
import { sitemapUrlFor } from './robots'
import { cachedSeoSettings } from './settings'
import { storagePublicUrl } from './urls'

/**
 * Site-wide head tags (docs/12 §4, §5, §6): `Organization` + `WebSite`/`SearchAction`
 * JSON-LD, `<link rel="sitemap">` and the site feed alternate. Rendered from the cached
 * seo_settings so the root layout stays static; a database failure renders nothing rather
 * than breaking the shell.
 */
export async function SeoHead() {
  let settings: Awaited<ReturnType<typeof cachedSeoSettings>>
  try {
    settings = await cachedSeoSettings()
  } catch {
    return null
  }
  const origin = new URL(getEnv().SITE_URL).origin
  const site = settings.identity.site_name
  const sitemap = sitemapUrlFor(settings, origin)
  const feed = settings.feeds.enabled ? (settings.feeds.custom_url ?? `${origin}/feed`) : null
  return (
    <>
      <JsonLd
        data={graphJsonLd([
          organizationJsonLd({
            name: site,
            url: origin,
            logo: storagePublicUrl(settings.identity.logo_key),
            sameAs: settings.identity.same_as,
          }),
          webSiteJsonLd({ name: site, url: origin }),
        ])}
      />
      {sitemap ? <link rel="sitemap" type="application/xml" href={sitemap} /> : null}
      {feed ? (
        <link rel="alternate" type="application/rss+xml" title={`${site} RSS`} href={feed} />
      ) : null}
    </>
  )
}

/** The footer RSS link target — the custom feed URL when set, null when feeds are off. */
export async function feedHref(): Promise<string | null> {
  try {
    const settings = await cachedSeoSettings()
    if (!settings.feeds.enabled) return null
    return settings.feeds.custom_url ?? '/feed'
  } catch {
    return null
  }
}
