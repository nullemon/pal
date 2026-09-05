import 'server-only'
import { getDb, getSetting } from '@palscans/db'
import { unstable_cache } from 'next/cache'
import type { BrandDocument, MenusDocument } from '@/lib/appearance/documents'
import { previewScopes } from '@/lib/appearance/preview'
import { draftDocuments } from '@/lib/appearance/versions'
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
 * 3. **A publish is visible immediately.** Both publish routes call `purgeSettings()`, which
 *    is `revalidateTag('settings')` + `revalidatePath('/', 'layout')`; the entry below
 *    carries the `settings` tag, so the next render rebuilds it. Saving a *draft* purges
 *    nothing, because it changes nothing the site reads.
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
 *
 * ## What the draft preview changed here, and what it did not
 *
 * `siteChrome()` now asks `lib/appearance/preview.ts` whether this request is a staff
 * preview before it reaches the cache. Point 1 above still holds and is the reason that is
 * safe: the question is answered by Next's Draft Mode, which resolves to "no" during every
 * prerender *without* marking the render dynamic, and no cookie is read on the way to that
 * answer. A reader's request follows exactly the path it followed before — one cached
 * object, no query. A previewing staff member's request is already being rendered on demand
 * (the `__prerender_bypass` cookie made it so) and pays for one extra uncached read.
 */

/**
 * `overrides` is the preview path and nothing else: an unpublished Brand or Menus draft
 * standing in for the live row for one staff viewer (docs/15 "Preview"). With none — every
 * request that is not a preview, which is every request the cache below ever serves — this
 * is byte for byte the read it always was.
 */
interface ChromeOverrides {
  brand?: BrandDocument
  menus?: MenusDocument
}

const loadChrome = async (overrides?: ChromeOverrides): Promise<SiteChrome> => {
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
    if (!overrides) return resolveChrome({ site, brand, menus, assetUrl: storageUrl })
    // A brand draft carries the name and tagline that live in `settings.site` alongside the
    // mark that lives in `settings.brand`; the split is put back here so the resolver sees
    // the same two shapes it always does.
    let siteRow = site
    let brandRow = brand
    if (overrides.brand) {
      const { name, tagline, ...mark } = overrides.brand
      siteRow = { ...(site && typeof site === 'object' ? site : {}), name, tagline }
      brandRow = mark
    }
    return resolveChrome({
      site: siteRow,
      brand: brandRow,
      menus: overrides.menus ?? menus,
      assetUrl: storageUrl,
    })
  } catch {
    return DEFAULT_CHROME
  }
}

const cached = unstable_cache(() => loadChrome(), ['site', 'chrome'], {
  revalidate: 60,
  tags: ['settings'],
})

/**
 * The resolved chrome for rendering. Cached; safe to call from a prerendered layout.
 *
 * The preview branch costs an anonymous visitor nothing: `previewScopes()` returns an empty
 * list without reading a cookie whenever draft mode is off — which is always, during a
 * prerender and for every reader — and the cached read below is reached exactly as before.
 * See `lib/appearance/preview.ts` for why that is true rather than hoped for.
 */
export const siteChrome = async (): Promise<SiteChrome> => {
  const scopes = await previewScopes()
  const wanted = scopes.filter((s) => s === 'brand' || s === 'menus')
  if (wanted.length === 0) return cached()
  const drafts: ChromeOverrides = await draftDocuments(wanted).catch(() => ({}))
  if (!drafts.brand && !drafts.menus) return cached()
  return loadChrome(drafts)
}

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
