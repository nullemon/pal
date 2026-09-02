import { messages } from '@palscans/core/messages'

/**
 * The admin navigation (docs/04 "Navigation", design/mockups/admin): groups Dashboard ·
 * Content · Community · Business · Appearance · System. Items are filtered by permission so
 * an uploader only sees what they can use.
 */
export type AdminIcon =
  | 'gauge'
  | 'library'
  | 'file-stack'
  | 'upload'
  | 'list-checks'
  | 'message-square'
  | 'flag'
  | 'users'
  | 'badge-dollar'
  | 'layout'
  | 'palette'
  | 'settings'
  | 'toggle'
  | 'cpu'
  | 'scroll'
  | 'search'

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

const m = messages.admin.nav

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
      { label: m.users, href: '/admin/users', icon: 'users', permission: 'user.read' },
    ],
  },
  {
    label: m.business,
    items: [
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
    ],
  },
  {
    label: m.system,
    items: [
      { label: m.seo, href: '/admin/seo', icon: 'search', permission: 'settings.write' },
      {
        label: m.settings,
        href: '/admin/settings',
        icon: 'settings',
        permission: 'settings.write',
        exact: true,
      },
      { label: m.featureFlags, href: '/admin/flags', icon: 'toggle', permission: 'settings.write' },
      { label: m.jobs, href: '/admin/jobs', icon: 'cpu', permission: 'chapter.update' },
      { label: m.auditLog, href: '/admin/audit', icon: 'scroll', permission: 'audit.read' },
    ],
  },
]

export const isNavActive = (pathname: string, item: AdminNavItem): boolean =>
  item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`)

/** Breadcrumb for the top bar: group label › item label, from the pathname. */
export const breadcrumbFor = (pathname: string): { group: string; page: string } => {
  let best: { group: string; item: AdminNavItem } | null = null
  for (const g of adminNav)
    for (const item of g.items)
      if (isNavActive(pathname, item) && (!best || item.href.length > best.item.href.length))
        best = { group: g.label, item }
  if (!best) return { group: m.dashboard, page: m.overview }
  return { group: best.group, page: best.item.label }
}
