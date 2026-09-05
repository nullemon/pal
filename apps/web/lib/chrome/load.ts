import 'server-only'
import { getDb, getSetting } from '@palscans/db'
import { unstable_cache } from 'next/cache'
import { ensureConfig } from '@/lib/config/install'
import { DEFAULT_CHROME, type SiteChrome } from '@/lib/site'
import { storageUrl } from '@/lib/storage'
import { type IconSet, iconHref, iconSet } from './icons'
import { resolveChrome } from './resolve'
import { brandSettingSchema, DEFAULT_BRAND_SETTING } from './schema'

/**
 * The site's chrome, read once and reused (docs/15 "Header, footer, menus").
 *
 * ## Why this does not make the site dynamic, and does not add a query per request
 *
 * The header and footer render on every page, including the ones docs/06 insists stay
 * prerendered (`/`, `/series/*`, the reader). Three things had to be true, and are:
 *
 * 1. **No request-scoped input.** This reads three `settings` rows and nothing else — no
 *    `cookies()`, no `headers()`, no `searchParams`. That is what keeps the route static;
 *    an `async` component is not by itself dynamic, only one that touches the request is.
 * 2. **No database round trip on the request path.** `unstable_cache` serves the resolved
 *    object from the data cache; at build time the value is baked into the prerendered HTML
 *    and afterwards one process-wide entry serves every render. This is the same mechanism
 *    the token block in `<head>` already uses (`lib/appearance/AppearanceStyle`, tag
 *    `appearance`) and the SEO settings behind every `generateMetadata`
 *    (`lib/seo/settings`, tag `settings`) — this is a third reader of an established
 *    pattern, not a new one.
 * 3. **A save is visible immediately.** Both admin routes call `purgeSettings()`, which is
 *    `revalidateTag('settings')` + `revalidatePath('/', 'layout')`; the entry below carries
 *    the `settings` tag, so the next render rebuilds it.
 *
 * `revalidate: 60` is the ceiling for changes this process did not make — another web
 * instance's save, and the announcement bar's start and end times, which are evaluated when
 * the entry is built. Sixty seconds is the window `lib/seo/snapshot.ts` and
 * `lib/entitlements.ts` already use for operator settings, chosen for the same reason: it
 * bounds a schedule boundary to something nobody would notice without regenerating pages
 * continuously. Note the consequence — an `unstable_cache` entry's `revalidate` also caps the
 * route segment's, so every prerendered page under the site layout now revalidates at least
 * this often. That is the price of a scheduled announcement bar arriving on time.
 *
 * If the database is unreachable the shipped defaults render, exactly as they did before any
 * of this was configurable — a settings read must never be able to take the site down.
 */

const loadChrome = async (): Promise<SiteChrome> => {
  try {
    const db = await getDb()
    // Warm the synchronous storage mirror before `storageUrl` builds the logo URLs, the same
    // way every other loader that emits a media URL does (lib/config/install.ts).
    await ensureConfig()
    const [site, brand, menus] = await Promise.all([
      getSetting<unknown>(db, 'site', null),
      getSetting<unknown>(db, 'brand', null),
      getSetting<unknown>(db, 'menus', null),
    ])
    return resolveChrome({ site, brand, menus, assetUrl: storageUrl })
  } catch {
    return DEFAULT_CHROME
  }
}

const cached = unstable_cache(loadChrome, ['site', 'chrome'], {
  revalidate: 60,
  tags: ['settings'],
})

/** The resolved chrome for rendering. Cached; safe to call from a prerendered layout. */
export const siteChrome = (): Promise<SiteChrome> => cached()

/**
 * The same read, uncached. The admin screens want it: `revalidateTag` marks an entry stale
 * rather than deleting it, so the render straight after a save can still serve the previous
 * value — on the screen whose job is showing what is stored, that is the one mistake it
 * cannot make (the same reasoning as `resolveConfig({ fresh: true })`).
 */
export const siteChromeFresh = (): Promise<SiteChrome> => loadChrome()

/** The stored brand document, parsed. Uncached — for the admin screen and the icon route. */
export const brandSetting = async () => {
  try {
    const raw = await getSetting<unknown>(await getDb(), 'brand', {})
    return brandSettingSchema.parse(raw ?? {})
  } catch {
    return DEFAULT_BRAND_SETTING
  }
}

/**
 * Which favicon and PWA icons to link to: the generated set when a monogram has been
 * uploaded, null when the shipped `public/icons/` files stand. Cached alongside the chrome
 * because `generateMetadata` and the manifest are on the same prerendered path.
 */
const cachedIcons = unstable_cache(
  async (): Promise<IconSet | null> => {
    await ensureConfig()
    return iconSet(await brandSetting(), storageUrl)
  },
  ['site', 'brand-icons'],
  { revalidate: 60, tags: ['settings'] },
)

export const brandIcons = (): Promise<IconSet | null> => cachedIcons()

/**
 * The default share image (docs/15 "Default social image: 1200×630 used when a page has no
 * better OG image").
 *
 * An uploaded image wins; otherwise, when a logo direction has been picked or a monogram
 * uploaded, the 1200×630 card generated from that mark stands in — so choosing a logo gives
 * the site a share card without a second upload. With nothing chosen there is no default and
 * pages fall back to whatever SEO → Identity names, exactly as before.
 */
export const brandSocialImage = async (): Promise<string | null> => {
  const [chrome, icons] = await Promise.all([siteChrome(), brandIcons()])
  if (chrome.brand.socialImage) return chrome.brand.socialImage.url
  return icons?.social ? iconHref(icons.version, 'social.png') : null
}
