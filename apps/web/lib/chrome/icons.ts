import { logoPreset } from './presets'
import type { BrandSetting } from './schema'

/**
 * Favicons, PWA icons and the default share card, derived from whichever mark the operator
 * chose (docs/15 "Favicon: generated from the monogram in every required size, including
 * maskable").
 *
 * ## What is generated, and what is not
 *
 * With **no preset picked and no monogram uploaded nothing here runs**: `iconSet()` returns
 * null and the metadata and manifest keep pointing at the files in `public/icons/`, so an
 * operator who configures nothing gets exactly the icons the site has always shipped.
 * Generation is the *configured* path, not a replacement for the default one.
 *
 * ## Sizes
 *
 * | asset | size | why |
 * |---|---|---|
 * | `icon-32.png` | 32 | the classic favicon, and what a browser tab actually paints |
 * | `icon-192.png` | 192 | manifest `any`, and Chrome's install prompt |
 * | `icon-512.png` | 512 | manifest `any`, splash screens |
 * | `apple-touch-icon.png` | 180 | iOS home screen; must be opaque or iOS fills it black |
 * | `maskable-192/512.png` | 192 / 512 | Android adaptive icons |
 * | `social.png` | 1200×630 | the default OG card when a page has no better image |
 *
 * A maskable icon is cropped by the launcher to whatever shape the device uses, so a
 * free-standing mark is inset into the middle 80% — the safe zone the spec guarantees
 * survives every mask — and the rest is filled with the operator's background colour.
 * Transparency is not allowed there: a transparent maskable icon comes out with a black
 * surround on most launchers. Three of the ten presets draw their own tile or disc
 * (`ownsContainer`) and are rendered full-bleed instead, because insetting them would frame a
 * frame.
 */

export const ICON_ASSETS = {
  'icon-32.png': { size: 32, kind: 'any' },
  'icon-192.png': { size: 192, kind: 'any' },
  'icon-512.png': { size: 512, kind: 'any' },
  'apple-touch-icon.png': { size: 180, kind: 'opaque' },
  'maskable-192.png': { size: 192, kind: 'maskable' },
  'maskable-512.png': { size: 512, kind: 'maskable' },
  'social.png': { size: 630, kind: 'social' },
} as const satisfies Record<
  string,
  { size: number; kind: 'any' | 'opaque' | 'maskable' | 'social' }
>

export type IconAsset = keyof typeof ICON_ASSETS

/** `hasOwn`, not `in`: the route's segment is user input, and `in` would accept `toString`. */
export const isIconAsset = (name: string): name is IconAsset => Object.hasOwn(ICON_ASSETS, name)

/** The default social card's dimensions (docs/15 "1200×630"). */
export const SOCIAL_CARD = { width: 1200, height: 630 } as const

/**
 * A short token that changes whenever the generated icons would change. It goes in the URL
 * path, which is what lets the route answer `immutable`: a new mark or background colour is a
 * new URL, so nothing has to be purged from a CDN or a browser cache.
 */
export const iconVersion = (brand: BrandSetting): string | null => {
  const source = brand.logo_preset ?? brand.monogram?.key
  if (!source) return null
  let h = 0x811c9dc5
  for (const ch of `${source}|${brand.monogram_bg}`) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

export interface IconSet {
  version: string
  /** The mark's own SVG URL when there is one — the sharpest favicon a browser can have. */
  svgUrl: string | null
  /** True when the generated 1200×630 card should stand in as the default share image. */
  social: boolean
}

/**
 * What `generateMetadata` and the manifest should link to, or null when nothing has been
 * chosen and the shipped files stand.
 */
export const iconSet = (brand: BrandSetting, assetUrl: (key: string) => string): IconSet | null => {
  const version = iconVersion(brand)
  if (!version) return null
  // A preset is inlined into the page rather than served as a file, so it has no URL of its
  // own; the generated PNGs cover it. An uploaded SVG monogram does have one, and an SVG
  // favicon beats every raster size a browser might pick.
  const svg =
    !brand.logo_preset && brand.monogram?.type === 'image/svg+xml'
      ? assetUrl(brand.monogram.key)
      : null
  return { version, svgUrl: svg, social: true }
}

export const iconHref = (version: string, asset: IconAsset): string => `/brand/${version}/${asset}`

/** True when the chosen mark draws its own container and must be rendered edge to edge. */
export const markOwnsContainer = (brand: BrandSetting): boolean =>
  logoPreset(brand.logo_preset)?.ownsContainer ?? false
