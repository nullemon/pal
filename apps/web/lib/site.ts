import { messages } from '@palscans/core/messages'

/**
 * The shape of the site's chrome — header, footer, menus, brand — and the values it falls
 * back to when the operator has configured nothing (docs/15 "Brand and identity" and
 * "Header, footer, menus").
 *
 * Two rules govern this file:
 *
 * 1. **It is client-safe and dependency-light.** `NavLinks` and `BottomNav` are client
 *    components, so anything imported here lands in every reader's bundle. Nothing but the
 *    copy catalogue is imported: no zod, no database, no `server-only`. The zod schemas that
 *    parse the stored documents live in `lib/chrome/schema.ts` and are imported only by the
 *    admin screens and the route handlers — a client module reaching through a boundary for
 *    one constant has cost this project 84 KB gzipped twice already (docs/20).
 * 2. **The defaults here are exactly what the site shipped with.** An operator who has saved
 *    nothing must see the header, footer and bottom nav the site had before Appearance could
 *    edit them, so `DEFAULT_CHROME` is the old hardcoded configuration, moved not rewritten.
 *
 * `lib/chrome/load.ts` merges the stored settings over these and hands the result to the
 * shell components.
 */

export interface NavLink {
  label: string
  href: string
  /** Match the pathname by prefix (e.g. /series/*) instead of exactly. */
  prefix?: boolean
}

/** A header link. `mobile` also puts it in the compact row under the header on phones. */
export interface HeaderLink extends NavLink {
  mobile: boolean
}

/**
 * The vocabulary the mobile bottom nav is built from (docs/15 "Mobile bottom nav: which
 * four items"). A closed list rather than free links because each item needs an icon, and
 * every icon here ships to every reader — see `components/shell/BottomNav`.
 */
export const BOTTOM_NAV_IDS = [
  'home',
  'browse',
  'rankings',
  'genres',
  'bookmarks',
  'history',
  'profile',
  'search',
] as const
export type BottomNavId = (typeof BOTTOM_NAV_IDS)[number]

export interface BottomNavItem extends NavLink {
  id: BottomNavId
}

export interface FooterColumn {
  title: string
  links: readonly NavLink[]
}

export const SOCIAL_NETWORKS = ['x', 'instagram', 'reddit', 'youtube', 'facebook'] as const
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]

export const SUPPORT_NETWORKS = ['patreon', 'kofi', 'buymeacoffee'] as const
export type SupportNetwork = (typeof SUPPORT_NETWORKS)[number]

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  x: 'X',
  instagram: 'Instagram',
  reddit: 'Reddit',
  youtube: 'YouTube',
  facebook: 'Facebook',
}

export const SUPPORT_LABELS: Record<SupportNetwork, string> = {
  patreon: 'Patreon',
  kofi: 'Ko-fi',
  buymeacoffee: 'Buy me a coffee',
}

export type WordmarkStyle = 'logo' | 'logo+name' | 'name'
export type AnnouncementTone = 'info' | 'warning' | 'promo'
/** Who sees the announcement bar — applied in the browser, see `AnnouncementBar`. */
export type AnnouncementAudience = 'everyone' | 'guests' | 'members'

/**
 * An uploaded brand image. The intrinsic size travels with the URL because the header is
 * above the fold on every page: without it the logo would be a layout shift on first paint,
 * and CLS is one of the two budgets CI gates (docs/06).
 */
export interface BrandAsset {
  url: string
  width: number
  height: number
}

export interface BrandChrome {
  name: string
  tagline: string
  wordmark: WordmarkStyle
  /**
   * One of the eleven directions in `design/logos/` (`lib/chrome/presets.ts`), or null for
   * "use my own". A preset wins over the uploads below, which stay stored so that switching
   * back to a custom logo does not mean uploading it again. With both unset, the built-in
   * monogram renders — the site as it shipped.
   */
  logoPreset: string | null
  /** Resolved from storage keys. Null means "use the preset, or the built-in mark". */
  logoDark: BrandAsset | null
  logoLight: BrandAsset | null
  monogram: BrandAsset | null
  socialImage: BrandAsset | null
}

/** The width an asset renders at when scaled to `height`, rounded to whole pixels. */
export const scaledWidth = (asset: BrandAsset, height: number): number =>
  Math.max(1, Math.round((asset.width / asset.height) * height))

export interface CommunityChrome {
  discordUrl: string | null
  socials: ReadonlyArray<{ network: SocialNetwork; label: string; href: string }>
  support: ReadonlyArray<{ network: SupportNetwork; label: string; href: string }>
  rss: boolean
}

export interface AnnouncementChrome {
  /** Restricted inline markup — see `lib/chrome/inline.ts`. Never raw HTML. */
  text: string
  tone: AnnouncementTone
  audience: AnnouncementAudience
  dismissible: boolean
  /** Stable per content+tone, so editing the bar shows it again to whoever dismissed it. */
  id: string
}

export interface SiteChrome {
  brand: BrandChrome
  header: readonly HeaderLink[]
  primaryButton: { label: string; href: string } | null
  footer: readonly FooterColumn[]
  bottomNav: readonly BottomNavItem[]
  community: CommunityChrome
  copyright: string
  attribution: string | null
  /** Null when off, empty, or outside its schedule. */
  announcement: AnnouncementChrome | null
}

/** The bottom-nav vocabulary's default label and target for each id. */
export const BOTTOM_NAV_DEFAULTS: Record<BottomNavId, NavLink> = {
  home: { label: messages.nav.home, href: '/' },
  browse: { label: messages.nav.browse, href: '/browse', prefix: true },
  rankings: { label: messages.nav.rankings, href: '/rankings', prefix: true },
  genres: { label: messages.nav.genres, href: '/genres', prefix: true },
  bookmarks: { label: messages.nav.bookmarks, href: '/me/bookmarks', prefix: true },
  history: { label: messages.nav.history, href: '/me/history', prefix: true },
  profile: { label: messages.account.profile, href: '/me/settings', prefix: true },
  search: { label: messages.nav.search, href: '/search', prefix: true },
}

/**
 * The "surprise me" doorway to `/random` (docs/13 "Random series"). One definition, used by
 * the header, the browse filter panel and the end-of-chapter card, so the label and the
 * destination cannot drift apart. `/random` is a 307 to a series — never prefetch it: a
 * prefetch would spend a roll the reader never asked for and cache the wrong destination.
 *
 * Not operator-editable: it is a mechanism, not a menu entry.
 */
export const randomLink: NavLink & { hint: string } = {
  label: messages.discover.surpriseMe,
  href: '/random',
  hint: messages.discover.surpriseMeHint,
}

/**
 * What the site renders when nothing is stored — the pre-Appearance configuration, verbatim.
 * `lib/chrome/resolve.test.ts` pins it, so a future edit cannot quietly change what an
 * unconfigured site looks like.
 *
 * Header links default to `mobile: false` because the header nav used to be `hidden md:block`
 * outright: flagging one for mobile *adds* a row that was never there, so an untouched site
 * is unchanged.
 */
export const DEFAULT_CHROME: SiteChrome = {
  brand: {
    name: messages.site.name,
    tagline: messages.site.tagline,
    wordmark: 'logo+name',
    logoPreset: null,
    logoDark: null,
    logoLight: null,
    monogram: null,
    socialImage: null,
  },
  header: [
    { label: messages.nav.home, href: '/', mobile: false },
    { label: messages.nav.browse, href: '/browse', prefix: true, mobile: false },
    { label: messages.nav.rankings, href: '/rankings', prefix: true, mobile: false },
    { label: messages.nav.genres, href: '/genres', prefix: true, mobile: false },
    { label: messages.nav.bookmarks, href: '/me/bookmarks', prefix: true, mobile: false },
  ],
  primaryButton: { label: messages.nav.premium, href: '/subscribe' },
  footer: [
    {
      title: messages.footer.browse,
      links: [
        { label: messages.footer.latestUpdates, href: '/?sort=latest' },
        { label: messages.footer.popular, href: '/rankings' },
        { label: messages.footer.genres, href: '/genres' },
        { label: messages.footer.rankings, href: '/rankings' },
        { label: messages.nav.random, href: '/random' },
        { label: messages.home.announcements, href: '/announcements' },
        // The request board (migration 9024). Filing a request is the header's modal; this is
        // the link to the board itself, for readers who want to see what is already asked for.
        { label: messages.requests.navLabel, href: '/requests' },
      ],
    },
    {
      title: messages.footer.account,
      links: [
        { label: messages.footer.bookmarks, href: '/me/bookmarks' },
        { label: messages.footer.readingHistory, href: '/me/history' },
        { label: messages.me.lists.title, href: '/me/lists' },
        { label: messages.me.stats.title, href: '/me/stats' },
        { label: messages.footer.notifications, href: '/me/settings#notifications' },
        { label: messages.footer.premium, href: '/subscribe' },
      ],
    },
    {
      title: messages.footer.legal,
      links: [
        { label: messages.footer.dmca, href: '/dmca' },
        { label: messages.footer.terms, href: '/terms' },
        { label: messages.footer.privacy, href: '/privacy' },
        { label: messages.footer.contact, href: '/contact' },
        // docs/17 §G / docs/13: the uptime page, reachable from every page without an account.
        { label: messages.status.navLabel, href: '/status' },
      ],
    },
  ],
  bottomNav: [
    { id: 'home', ...BOTTOM_NAV_DEFAULTS.home },
    { id: 'browse', ...BOTTOM_NAV_DEFAULTS.browse },
    { id: 'bookmarks', ...BOTTOM_NAV_DEFAULTS.bookmarks },
    { id: 'profile', ...BOTTOM_NAV_DEFAULTS.profile },
  ],
  community: {
    discordUrl: 'https://discord.gg/palscans',
    socials: [
      { network: 'x', label: SOCIAL_LABELS.x, href: 'https://x.com/palscans' },
      {
        network: 'instagram',
        label: SOCIAL_LABELS.instagram,
        href: 'https://instagram.com/palscans',
      },
      { network: 'reddit', label: SOCIAL_LABELS.reddit, href: 'https://reddit.com/r/palscans' },
      { network: 'youtube', label: SOCIAL_LABELS.youtube, href: 'https://youtube.com/@palscans' },
      { network: 'facebook', label: SOCIAL_LABELS.facebook, href: 'https://facebook.com/palscans' },
    ],
    support: [],
    rss: false,
  },
  copyright: messages.site.copyright,
  attribution: null,
  announcement: null,
}

export function isActive(pathname: string, link: NavLink): boolean {
  if (link.href === '/') return pathname === '/'
  const target = link.href.split(/[?#]/)[0] ?? link.href
  return link.prefix
    ? pathname === target || pathname.startsWith(`${target}/`)
    : pathname === target
}

/**
 * The wordmark's two-weight split: "PALScans" renders as a heavy **PAL** followed by a light
 * *Scans*, and a renamed site should keep that treatment rather than losing it.
 *
 * The rule is "a leading run of two or more capitals followed by a capital-then-lowercase" —
 * the shape of an acronym prefix. "PALScans" → PAL / Scans; "Toonily" has no such run and
 * renders in one weight, which is the right answer for it.
 */
export function splitWordmark(name: string): [string, string] {
  const match = /^([A-Z0-9]{2,})([A-Z][a-z].*)$/.exec(name)
  return match ? [match[1] as string, match[2] as string] : [name, '']
}
