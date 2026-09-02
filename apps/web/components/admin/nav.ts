import { can, isPermission, type SessionUser } from '@palscans/core'
import { type AdminNavGroup, adminNav } from './nav-shared'

export * from './nav-shared'

/** Server-only: the groups a user may see (`can()` from @palscans/core decides). */
export const navForUser = (user: SessionUser): AdminNavGroup[] =>
  adminNav
    .map((g) => ({
      label: g.label,
      items: g.items.filter((i) => isPermission(i.permission) && can(user, i.permission)),
    }))
    .filter((g) => g.items.length > 0)
