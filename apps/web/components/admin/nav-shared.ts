import { messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'

/**
 * The admin navigation (docs/04 "Navigation", design/mockups/admin): groups Dashboard ·
 * Content · Community · Business · Appearance · System. Items are filtered by permission so
 * an uploader only sees what they can use.
 */
export type AdminIcon =
  | 'gauge'
  | 'chart-line'
  | 'library'
  | 'file-stack'
  | 'megaphone'
  | 'file-text'
  | 'upload'
  | 'list-checks'
  | 'message-square'
  | 'flag'
  | 'users'
  | 'badge-dollar'
  | 'zap'
  | 'layout'
  | 'palette'
  | 'stamp'
  | 'settings'
  | 'toggle'
  | 'cpu'
  | 'scroll'
  | 'search'
  | 'shield'
  | 'bell'
  | 'plug'

export interface AdminNavItem {
  label: string
  href: string
  icon: AdminIcon
  /** A @palscans/core Permission; typed as string here so this module stays client-safe. */
  permission: string
  /** Match by prefix (default) or exactly. */
  exact?: boolean
}

export interface AdminNavGroup {
  label: string
  items: AdminNavItem[]
}

const m = adminMessages.admin.nav

export const adminNav: readonly AdminNavGroup[] = [
  {
    label: m.dashboard,
    items: [
      { label: m.overview, href: '/admin', icon: 'gauge', permission: 'admin.access', exact: true },
    ],
  },
  {
    label: m.content,
    items: [
      { label: m.series, href: '/admin/series', icon: 'library', permission: 'series.read' },
      // Duplicate detection (docs/09 legacy import): pairs that look like one work under two
      // rows. Listing is `series.read`; the merge behind it is `series.delete`.
      {
        label: adminMessages.duplicates.navLabel,
        href: '/admin/series/duplicates',
        icon: 'search',
        permission: 'series.read',
      },
      {
        label: m.chapters,
        href: '/admin/chapters',
        icon: 'file-stack',
        permission: 'chapter.read',
      },
      {
        label: m.upload,
        href: '/admin/upload',
        icon: 'upload',
        permission: 'chapter.create',
        exact: true,
      },
      {
        label: m.uploadQueue,
        href: '/admin/upload/queue',
        icon: 'list-checks',
        permission: 'chapter.read',
      },
      // Announcement authoring (docs/04 Content group): the /announcements posts and feed.
      {
        label: adminMessages.adminContent.nav.announcements,
        href: '/admin/announcements',
        icon: 'megaphone',
        permission: 'announcement.write',
      },
    ],
  },
  {
    label: m.community,
    items: [
      {
        label: m.comments,
        href: '/admin/comments',
        icon: 'message-square',
        permission: 'comment.moderate',
      },
      { label: m.reports, href: '/admin/reports', icon: 'flag', permission: 'report.handle' },
      // Queue health (docs/04 Community, docs/07 SLA): the three queues' age, throughput and
      // who is working them. Same gate as the queues themselves — see app/admin/moderation.
      {
        label: adminMessages.queueHealth.navLabel,
        href: '/admin/moderation',
        icon: 'gauge',
        permission: 'report.handle',
      },
      // DMCA ledger (docs/07 "Content compliance"): the notices from /dmca and their outcome.
      {
        label: messages.takedowns.navLabel,
        href: '/admin/takedowns',
        icon: 'shield',
        permission: 'report.handle',
      },
      // The series request board (migration 9024). `report.handle` rather than a new
      // permission: this is reader-submitted content staff answer publicly, the same job as
      // the reports queue and the DMCA ledger sitting either side of it.
      {
        label: messages.requests.admin.title,
        href: '/admin/requests',
        icon: 'list-checks',
        permission: 'report.handle',
      },
      { label: m.users, href: '/admin/users', icon: 'users', permission: 'user.read' },
      // D · Notifications (docs/17 §D): what fires, to whom, and the send-test controls.
      {
        label: messages.notify.navLabel,
        href: '/admin/notifications',
        icon: 'bell',
        permission: 'settings.write',
      },
    ],
  },
  {
    label: m.business,
    items: [
      { label: m.premium, href: '/admin/premium', icon: 'zap', permission: 'settings.write' },
      { label: m.ads, href: '/admin/ads', icon: 'badge-dollar', permission: 'settings.write' },
    ],
  },
  {
    label: m.appearance,
    items: [
      {
        label: m.layouts,
        href: '/admin/appearance/layouts',
        icon: 'layout',
        permission: 'settings.write',
      },
      {
        label: m.theme,
        href: '/admin/appearance/theme',
        icon: 'palette',
        permission: 'settings.write',
      },
      // The attribution burned into every page image by `chapter.process` (docs/03).
      {
        label: m.watermark,
        href: '/admin/appearance/watermark',
        icon: 'stamp',
        permission: 'settings.write',
      },
    ],
  },
  {
    label: m.system,
    items: [
      // Analytics (docs/13: "the System group gains … Analytics") — the view pipeline's
      // numbers. `settings.write` keeps it where the rest of System already is: staff who
      // run the site, not everyone who can open the panel.
      {
        label: adminMessages.admin.analytics.navLabel,
        href: '/admin/analytics',
        icon: 'chart-line',
        permission: 'settings.write',
      },
      { label: m.seo, href: '/admin/seo', icon: 'search', permission: 'settings.write' },
      // E · Legacy site importer (docs/17 §E).
      {
        label: m.importer,
        href: '/admin/import',
        icon: 'upload',
        permission: 'settings.write',
      },
      {
        label: m.settings,
        href: '/admin/settings',
        icon: 'settings',
        permission: 'settings.write',
        exact: true,
      },
      // Legal / help pages (docs/13 §"the System group gains … Legal pages").
      {
        label: adminMessages.adminContent.nav.pages,
        href: '/admin/pages',
        icon: 'file-text',
        permission: 'settings.write',
      },
      { label: m.access, href: '/admin/access', icon: 'shield', permission: 'settings.write' },
      // Credentials the operator can type in rather than deploy (docs/19).
      {
        label: m.integrations,
        href: '/admin/integrations',
        icon: 'plug',
        permission: 'settings.write',
      },
      { label: m.featureFlags, href: '/admin/flags', icon: 'toggle', permission: 'settings.write' },
      { label: m.jobs, href: '/admin/jobs', icon: 'cpu', permission: 'chapter.update' },
      // docs/17 §G — the nightly database dump, and the button that takes one now.
      {
        label: adminMessages.backup.navLabel,
        href: '/admin/system/backup',
        icon: 'file-stack',
        permission: 'settings.write',
      },
      { label: m.auditLog, href: '/admin/audit', icon: 'scroll', permission: 'audit.read' },
    ],
  },
]

const covers = (pathname: string, item: AdminNavItem): boolean =>
  item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`)

/**
 * The nav entry a path belongs to: the longest one that covers it. Nested screens exist
 * (`/admin/series/duplicates` sits under `/admin/series`), and without the longest-match
 * rule a prefix item would light up alongside the one the reader is actually on.
 */
const bestFor = (pathname: string): { group: string; item: AdminNavItem } | null => {
  let best: { group: string; item: AdminNavItem } | null = null
  for (const g of adminNav)
    for (const item of g.items)
      if (covers(pathname, item) && (!best || item.href.length > best.item.href.length))
        best = { group: g.label, item }
  return best
}

export const isNavActive = (pathname: string, item: AdminNavItem): boolean =>
  covers(pathname, item) && bestFor(pathname)?.item.href === item.href

/** Breadcrumb for the top bar: group label › item label, from the pathname. */
export const breadcrumbFor = (pathname: string): { group: string; page: string } => {
  const best = bestFor(pathname)
  if (!best) return { group: m.dashboard, page: m.overview }
  return { group: best.group, page: best.item.label }
}
