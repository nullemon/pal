import type { z } from 'zod'
import {
  type AnnouncementChrome,
  BOTTOM_NAV_DEFAULTS,
  type BottomNavId,
  type BottomNavItem,
  type BrandAsset,
  DEFAULT_CHROME,
  type FooterColumn,
  type HeaderLink,
  type SiteChrome,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
  SUPPORT_LABELS,
  SUPPORT_NETWORKS,
} from '@/lib/site'
import {
  announcementSchema,
  type BrandAssetSetting,
  bottomNavIdSchema,
  brandSettingSchema,
  communitySchema,
  footerColumnSchema,
  headerLinkSchema,
  menusSettingSchema,
} from './schema'

/**
 * Merge the stored `settings.site`, `settings.brand` and `settings.menus` rows over the
 * shipped defaults (`DEFAULT_CHROME`) into the one object the shell renders.
 *
 * Pure, and that is the point: every fallback rule below is asserted in `resolve.test.ts`
 * without a database. The rules, in one place:
 *
 * - **A key that is absent falls back**, field by field, to what the site shipped with. An
 *   operator who has configured nothing sees exactly the old hardcoded chrome.
 * - **A key that is present is honoured, including when it is empty.** `footer: []` means
 *   "no footer columns", not "give me the defaults" — otherwise a column could never be
 *   removed. The exception is a list whose every entry is invalid, which is treated as a
 *   corrupt row rather than an intent.
 * - **A malformed field never throws.** This runs inside a layout on every page; a bad row
 *   must degrade to the default, not take the site down.
 *
 * Storage keys become URLs through the injected `assetUrl` so this module stays free of
 * `server-only` and the storage adapter, and the tests stay synchronous.
 */

export interface ResolveInput {
  site: unknown
  brand: unknown
  menus: unknown
  assetUrl: (key: string) => string
  now?: Date
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const text = (v: unknown): string | null => (typeof v === 'string' ? v.trim() : null)

/** One field: parse it, or fall back when it is absent or unparseable. */
const parseOr = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
  if (value === undefined || value === null) return fallback
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : fallback
}

/**
 * A list field. Invalid entries are dropped one by one so a single bad link cannot empty the
 * navigation; a list where nothing survived is treated as corrupt and falls back.
 */
const parseList = <T>(
  schema: z.ZodType<T>,
  value: unknown,
  fallback: readonly T[],
): readonly T[] => {
  if (!Array.isArray(value)) return fallback
  const kept: T[] = []
  for (const entry of value) {
    const parsed = schema.safeParse(entry)
    if (parsed.success) kept.push(parsed.data)
  }
  if (value.length > 0 && kept.length === 0) return fallback
  return kept
}

/**
 * A short, stable id for the bar's current content. Dismissal is remembered against it, so
 * editing the announcement shows it again to everyone who dismissed the previous one — the
 * behaviour an operator expects when they put up a new notice. FNV-1a rather than
 * `node:crypto` so this module runs unchanged in a test, on the server and (if it ever moves)
 * in the browser.
 */
export const announcementId = (text: string, tone: string): string => {
  let h = 0x811c9dc5
  for (const ch of `${tone}|${text}`) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

const toAsset = (
  stored: BrandAssetSetting,
  assetUrl: (key: string) => string,
): BrandAsset | null =>
  stored ? { url: assetUrl(stored.key), width: stored.width, height: stored.height } : null

const inWindow = (from: string | null, to: string | null, now: Date): boolean => {
  const at = now.getTime()
  if (from) {
    const start = Date.parse(from)
    if (Number.isFinite(start) && at < start) return false
  }
  if (to) {
    const end = Date.parse(to)
    if (Number.isFinite(end) && at > end) return false
  }
  return true
}

const resolveAnnouncement = (raw: unknown, now: Date): AnnouncementChrome | null => {
  const parsed = announcementSchema.safeParse(record(raw))
  if (!parsed.success) return null
  const a = parsed.data
  if (!a.enabled || !a.text) return null
  if (!inWindow(a.starts_at, a.ends_at, now)) return null
  return {
    text: a.text,
    tone: a.tone,
    audience: a.audience,
    dismissible: a.dismissible,
    id: announcementId(a.text, a.tone),
  }
}

/**
 * Ids are validated one at a time rather than as a list: the stored row is capped at four by
 * the admin route, but a longer or partly-unknown row must still produce a usable tab bar
 * instead of silently reverting the operator's whole choice.
 */
const resolveBottomNav = (raw: unknown): readonly BottomNavItem[] => {
  if (!Array.isArray(raw)) return DEFAULT_CHROME.bottomNav
  const ids: BottomNavId[] = []
  for (const value of raw) {
    const parsed = bottomNavIdSchema.safeParse(value)
    if (parsed.success && !ids.includes(parsed.data)) ids.push(parsed.data)
  }
  const capped = ids.slice(0, 4)
  if (capped.length === 0) return DEFAULT_CHROME.bottomNav
  return capped.map((id) => ({ id, ...BOTTOM_NAV_DEFAULTS[id] }))
}

const resolveCommunity = (menus: Record<string, unknown>, site: Record<string, unknown>) => {
  const fallbackSocials = record(site.socials)
  const fallbackSupport = record(site.support_links)
  const parsed = menus.community === undefined ? null : communitySchema.safeParse(menus.community)
  const community = parsed?.success ? parsed.data : null

  const socialHref = (network: (typeof SOCIAL_NETWORKS)[number]): string | null => {
    if (community) return community.socials[network]
    const seeded = text(fallbackSocials[network])
    if (seeded) return seeded
    return DEFAULT_CHROME.community.socials.find((s) => s.network === network)?.href ?? null
  }
  const supportHref = (network: (typeof SUPPORT_NETWORKS)[number]): string | null =>
    community ? community.support[network] : text(fallbackSupport[network])

  return {
    // A community block that is present decides, including when it clears a field: without
    // that, an operator could never remove the Discord button.
    discordUrl: community
      ? community.discord_url
      : (text(site.discord_url) ?? DEFAULT_CHROME.community.discordUrl),
    socials: SOCIAL_NETWORKS.flatMap((network) => {
      const href = socialHref(network)
      return href ? [{ network, label: SOCIAL_LABELS[network], href }] : []
    }),
    support: SUPPORT_NETWORKS.flatMap((network) => {
      const href = supportHref(network)
      return href ? [{ network, label: SUPPORT_LABELS[network], href }] : []
    }),
    rss: community?.rss ?? DEFAULT_CHROME.community.rss,
  }
}

/**
 * A `settings.menus` row written before this screen existed.
 *
 * The seed has shipped a `menus` row since long before anything read it, and its links have
 * drifted from the hardcoded chrome the site actually rendered — four footer links per column
 * where the site showed seven, `/premium` where the site linked `/subscribe`, three header
 * links flagged for a phone row that did not exist. Honouring that row on the first deploy
 * would quietly delete links from every existing install's footer.
 *
 * Such a row is recognisable by its exact shape: the four keys the seed wrote and none of the
 * four the Menus screen always writes. The test is deliberately narrow — a partial row with
 * only `header` is honoured, because the screen never produces one, so it can only be a
 * deliberate hand edit.
 */
const isPreFeatureMenus = (menus: Record<string, unknown>): boolean =>
  menus.header !== undefined &&
  menus.primary_button !== undefined &&
  menus.footer !== undefined &&
  menus.bottom_nav !== undefined &&
  menus.community === undefined &&
  menus.copyright === undefined &&
  menus.attribution === undefined &&
  menus.announcement === undefined

export function resolveChrome(input: ResolveInput): SiteChrome {
  const site = record(input.site)
  const stored = record(input.menus)
  const menus = isPreFeatureMenus(stored) ? {} : stored
  const brand = parseOr(brandSettingSchema, input.brand, brandSettingSchema.parse({}))
  const now = input.now ?? new Date()

  const name = text(site.name) || DEFAULT_CHROME.brand.name
  const tagline = typeof site.tagline === 'string' ? site.tagline : DEFAULT_CHROME.brand.tagline

  const primary = parseOr(
    menusSettingSchema.shape.primary_button,
    menus.primary_button,
    null as z.infer<typeof menusSettingSchema.shape.primary_button> | null,
  )

  return {
    brand: {
      name,
      tagline,
      wordmark: brand.wordmark,
      logoPreset: brand.logo_preset,
      logoDark: toAsset(brand.logo_dark, input.assetUrl),
      logoLight: toAsset(brand.logo_light, input.assetUrl),
      monogram: toAsset(brand.monogram, input.assetUrl),
      socialImage: toAsset(brand.social_image, input.assetUrl),
    },
    header: parseList(
      headerLinkSchema,
      menus.header,
      DEFAULT_CHROME.header,
    ) as readonly HeaderLink[],
    primaryButton: primary
      ? primary.enabled
        ? { label: primary.label, href: primary.href }
        : null
      : DEFAULT_CHROME.primaryButton,
    footer: parseList<FooterColumn>(footerColumnSchema, menus.footer, DEFAULT_CHROME.footer).slice(
      0,
      4,
    ),
    bottomNav: resolveBottomNav(menus.bottom_nav),
    community: resolveCommunity(menus, site),
    copyright: typeof menus.copyright === 'string' ? menus.copyright : DEFAULT_CHROME.copyright,
    attribution: text(menus.attribution),
    announcement: resolveAnnouncement(menus.announcement, now),
  }
}
