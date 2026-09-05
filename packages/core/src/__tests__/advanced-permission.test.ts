import { describe, expect, it } from 'vitest'
import {
  ADMIN_ONLY_PERMISSIONS,
  grants,
  type Permission,
  type PermissionOverrides,
  pruneOverrides,
  ROLES,
  type Role,
  resolvePermissions,
} from '../permissions.js'

/**
 * `appearance.advanced` grants the ability to put arbitrary CSS and arbitrary `<script>` on
 * every public page — which is every reader's session. The roles matrix is itself only
 * `settings.write`, so without a hard floor an operator could hand script injection to a
 * moderator in two clicks, and a hand-edited settings row could do it silently.
 */
describe('script injection cannot be delegated', () => {
  it('is refused to every role but admin, whatever the stored matrix says', () => {
    const hostile = Object.fromEntries(
      ROLES.map((r: Role) => [r, Object.fromEntries(ADMIN_ONLY_PERMISSIONS.map((p) => [p, true]))]),
    ) as PermissionOverrides
    for (const role of ROLES)
      for (const permission of ADMIN_ONLY_PERMISSIONS)
        expect(grants(role, permission, hostile), `${role}/${permission}`).toBe(role === 'admin')
  })

  it('is never stored as an override, so the row cannot carry a grant at all', () => {
    for (const role of ROLES)
      for (const permission of ADMIN_ONLY_PERMISSIONS) {
        const stored = pruneOverrides({ [role]: { [permission]: true } } as PermissionOverrides)
        expect(stored[role]?.[permission], `${role}/${permission}`).toBeUndefined()
      }
  })

  it('admin still holds it with nothing configured', () => {
    for (const permission of ADMIN_ONLY_PERMISSIONS)
      expect(resolvePermissions('admin')).toContain(permission as Permission)
  })
})
