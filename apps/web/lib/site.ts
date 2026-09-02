import { messages } from '@palscans/core/messages'

/**
 * Site-wide navigation and footer config. One source of truth for the header, the mobile
 * bottom nav and the footer columns; Appearance → Header, footer, menus (docs/15) will
 * eventually feed this from the database. Labels come from `messages` (docs/16: all UI copy
 * goes through packages/core/src/messages.ts).
 */

export interface NavLink {
  label: string
  href: string
  /** Match the pathname by prefix (e.g. /series/*) instead of exactly. */
  prefix?: boolean
}

export const site = {
  name: messages.site.name,
  tagline: messages.site.tagline,
  copyright: messages.site.copyright,
  discordUrl: 'https://discord.gg/palscans',
} as const

export const headerNav: readonly NavLink[] = [
  { label: messages.nav.home, href: '/' },
  { label: messages.nav.browse, href: '/browse', prefix: true },
  { label: messages.nav.rankings, href: '/rankings', prefix: true },
  { label: messages.nav.genres, href: '/genres', prefix: true },
  { label: messages.nav.bookmarks, href: '/me/bookmarks', prefix: true },
]

export type BottomNavIcon = 'home' | 'browse' | 'library' | 'profile'

export const bottomNav: ReadonlyArray<NavLink & { icon: BottomNavIcon }> = [
  { label: messages.nav.home, href: '/', icon: 'home' },
  { label: messages.nav.browse, href: '/browse', icon: 'browse', prefix: true },
  { label: messages.nav.bookmarks, href: '/me/bookmarks', icon: 'library', prefix: true },
  { label: messages.account.profile, href: '/me/settings', icon: 'profile', prefix: true },
]

export interface FooterColumn {
  title: string
  links: readonly NavLink[]
}

export const footerColumns: readonly FooterColumn[] = [
  {
    title: messages.footer.browse,
    links: [
      { label: messages.footer.latestUpdates, href: '/?sort=latest' },
      { label: messages.footer.popular, href: '/rankings' },
      { label: messages.footer.genres, href: '/genres' },
      { label: messages.footer.rankings, href: '/rankings' },
    ],
  },
  {
    title: messages.footer.account,
    links: [
      { label: messages.footer.bookmarks, href: '/me/bookmarks' },
      { label: messages.footer.readingHistory, href: '/me/history' },
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
    ],
  },
]

export type SocialNetwork = 'x' | 'instagram' | 'reddit' | 'youtube' | 'facebook'

export const socialLinks: ReadonlyArray<{ network: SocialNetwork; label: string; href: string }> = [
  { network: 'x', label: 'X', href: 'https://x.com/palscans' },
  { network: 'instagram', label: 'Instagram', href: 'https://instagram.com/palscans' },
  { network: 'reddit', label: 'Reddit', href: 'https://reddit.com/r/palscans' },
  { network: 'youtube', label: 'YouTube', href: 'https://youtube.com/@palscans' },
  { network: 'facebook', label: 'Facebook', href: 'https://facebook.com/palscans' },
]

export function isActive(pathname: string, link: NavLink): boolean {
  if (link.href === '/') return pathname === '/'
  const target = link.href.split(/[?#]/)[0] ?? link.href
  return link.prefix
    ? pathname === target || pathname.startsWith(`${target}/`)
    : pathname === target
}
