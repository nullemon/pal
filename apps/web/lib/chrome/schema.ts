import { z } from 'zod'
import { BOTTOM_NAV_IDS, type BottomNavId } from '@/lib/site'
import { LOGO_PRESET_IDS } from './presets'

/**
 * The two documents Appearance → Brand and Appearance → Menus store (docs/15). Both live in
 * the generic `settings` table — `settings.brand` and `settings.menus` — because neither
 * needs the draft/publish/version machinery `appearance_settings` carries for the theme, and
 * a jsonb row that already exists beats a migration.
 *
 * **This module imports zod, so nothing the public site renders may import it.** The shell
 * components take a resolved `SiteChrome` (`@/lib/site`, zod-free); only the admin screens,
 * the route handlers and `./resolve.ts` come here. See docs/20 "Front-end budgets".
 *
 * Every field `.catch(...)`es to a shipped default, so a hand-edited or half-written row
 * still renders a site rather than throwing inside a layout.
 */

/** A link target an operator may type: a site path, or an absolute http(s) URL. */
export const linkHref = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((v) => v.startsWith('/') || /^https?:\/\/[^/]/i.test(v), {
    message: 'Use a path like /browse or a full https:// address',
  })

const label = z.string().trim().min(1).max(40)
const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || /^https?:\/\/[^/]/i.test(v), {
    message: 'Use a full https:// address',
  })
  .transform((v) => (v === '' ? null : v))
  .nullable()

/**
 * A brand image the confirm step accepted. The key is constrained to the `brand/` prefix the
 * upload route mints, so a hand-edited row cannot point the site's logo at a chapter page or
 * anything else in the bucket. Intrinsic width and height are recorded at confirm time and
 * carried here so the header can reserve the logo's box and shift nothing (docs/06 CLS).
 */
export const brandAssetSchema = z
  .object({
    key: z
      .string()
      .trim()
      .max(300)
      .regex(/^brand\/[a-z0-9][a-z0-9._/-]*$/, 'not a brand asset key'),
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
    type: z.string().trim().max(60).catch(''),
  })
  .nullable()
export type BrandAssetSetting = z.infer<typeof brandAssetSchema>

const asset = brandAssetSchema.catch(null)

export const BRAND_SLOTS = ['logo_dark', 'logo_light', 'monogram', 'social_image'] as const
export type BrandSlot = (typeof BRAND_SLOTS)[number]

export const brandSettingSchema = z.object({
  wordmark: z.enum(['logo', 'logo+name', 'name']).catch('logo+name'),
  /**
   * One of the ten directions in `design/logos/`, or null for "use my own".
   *
   * A preset and an upload are two sources for the *same* setting rather than two settings:
   * whichever is chosen last wins, and the uploads below are kept either way, so picking a
   * preset and then going back to a custom logo does not mean uploading it again.
   */
  logo_preset: z.enum(LOGO_PRESET_IDS).nullable().catch(null),
  logo_dark: asset,
  logo_light: asset,
  monogram: asset,
  social_image: asset,
  /**
   * The square behind the mark in the maskable and Apple icons. Those must be opaque — a
   * transparent maskable icon comes out with a black surround on most Android launchers — and
   * the right colour depends on the mark, so the operator picks it.
   *
   * The default is the site's own dark ground rather than the accent: seven of the ten logo
   * directions are drawn *in* the accent, and on an accent square they disappear entirely.
   * `#100d17` is also the manifest's background and theme colour, so an installed app opens on
   * the colour its icon sits on.
   */
  monogram_bg: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .transform((s) => s.toLowerCase())
    .catch('#100d17'),
})
export type BrandSetting = z.infer<typeof brandSettingSchema>

export const DEFAULT_BRAND_SETTING: BrandSetting = brandSettingSchema.parse({})

export const headerLinkSchema = z.object({
  label,
  href: linkHref,
  prefix: z.boolean().catch(false),
  mobile: z.boolean().catch(false),
})

export const footerLinkSchema = z.object({ label, href: linkHref })

export const footerColumnSchema = z.object({
  title: z.string().trim().min(1).max(40),
  links: z.array(footerLinkSchema).max(12),
})

/**
 * `account` is the id the seeded row shipped with before this vocabulary was fixed; it means
 * the same thing as `profile`. Accepted as an alias so an existing row keeps four tabs.
 */
export const bottomNavIdSchema = z
  .string()
  .transform((v) => (v === 'account' ? 'profile' : v))
  .pipe(z.enum(BOTTOM_NAV_IDS))

export const announcementSchema = z.object({
  enabled: z.boolean().catch(false),
  /** Restricted inline markup (lib/chrome/inline.ts), never HTML. */
  text: z.string().trim().max(300).catch(''),
  tone: z.enum(['info', 'warning', 'promo']).catch('info'),
  starts_at: z.string().datetime({ offset: true }).nullable().catch(null),
  ends_at: z.string().datetime({ offset: true }).nullable().catch(null),
  audience: z.enum(['everyone', 'guests', 'members']).catch('everyone'),
  dismissible: z.boolean().catch(true),
})
export type AnnouncementSetting = z.infer<typeof announcementSchema>

const socialsSchema = z.object({
  x: optionalUrl.catch(null),
  instagram: optionalUrl.catch(null),
  reddit: optionalUrl.catch(null),
  youtube: optionalUrl.catch(null),
  facebook: optionalUrl.catch(null),
})

const supportSchema = z.object({
  patreon: optionalUrl.catch(null),
  kofi: optionalUrl.catch(null),
  buymeacoffee: optionalUrl.catch(null),
})

export const communitySchema = z.object({
  discord_url: optionalUrl.catch(null),
  socials: socialsSchema.catch({
    x: null,
    instagram: null,
    reddit: null,
    youtube: null,
    facebook: null,
  }),
  support: supportSchema.catch({ patreon: null, kofi: null, buymeacoffee: null }),
  rss: z.boolean().catch(false),
})

export const menusSettingSchema = z.object({
  header: z.array(headerLinkSchema).max(12),
  primary_button: z.object({
    enabled: z.boolean().catch(true),
    label,
    href: linkHref,
  }),
  footer: z.array(footerColumnSchema).max(4),
  bottom_nav: z.array(bottomNavIdSchema).max(4),
  community: communitySchema,
  copyright: z.string().trim().max(300),
  attribution: z.string().trim().max(300).nullable(),
  announcement: announcementSchema,
})
export type MenusSetting = z.infer<typeof menusSettingSchema>

/** The bottom-nav ids as a set, for the admin screen's checkbox list. */
export const BOTTOM_NAV_OPTIONS: readonly BottomNavId[] = BOTTOM_NAV_IDS
