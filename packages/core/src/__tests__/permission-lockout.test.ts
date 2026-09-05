import { describe, expect, it } from 'vitest'
import {
  grants,
  isDefaultPermission,
  LOCKED_PERMISSIONS,
  PERMISSIONS,
  type Permission,
  type PermissionOverrides,
  pruneOverrides,
  ROLES,
  type Role,
  resolvePermissions,
} from '../permissions.js'

/**
 * The two ways an editable permission matrix ruins a deployment: an operator locks themselves
 * out of their own panel, or a permission added in code later is silently denied to everyone
 * because no stored row mentions it. Both are checked here against the raw resolver, not
 * through the screen that is supposed to prevent them.
 */
describe('an operator cannot lock themselves out', () => {
  it('keeps the locked cells granted even when the stored row says false', () => {
    // Not what the UI would ever submit — what a hand-edited settings row, a rolled-back
    // deploy or a malicious write could contain.
    const hostile = {
      admin: Object.fromEntries(PERMISSIONS.map((p: Permission) => [p, false])),
    } as PermissionOverrides
    for (const permission of LOCKED_PERMISSIONS.admin)
      expect(grants('admin', permission, hostile), permission).toBe(true)
  })

  it('refuses to store a locked cell at all', () => {
    const stored = pruneOverrides({ admin: { 'admin.access': false } } as PermissionOverrides)
    expect(stored.admin?.['admin.access']).toBeUndefined()
  })

  it('leaves at least one role able to reach the panel and edit the matrix', () => {
    const hostile = Object.fromEntries(
      ROLES.map((r: Role) => [
        r,
        Object.fromEntries(PERMISSIONS.map((p: Permission) => [p, false])),
      ]),
    ) as PermissionOverrides
    const admin = resolvePermissions('admin', hostile)
    expect(admin).toContain('admin.access')
    expect(admin).toContain('settings.write')
  })
})

describe('a permission the stored document has never heard of', () => {
  it('falls back to the compiled default for every role', () => {
    // Simulates the deploy that adds a permission: the stored matrix predates it entirely.
    const stale: PermissionOverrides = { moderator: { 'report.handle': false } }
    for (const role of ROLES)
      for (const permission of PERMISSIONS) {
        if (role === 'moderator' && permission === 'report.handle') continue
        expect(grants(role, permission, stale), `${role}/${permission}`).toBe(
          isDefaultPermission(role, permission) || LOCKED_PERMISSIONS[role].includes(permission),
        )
      }
  })
})

describe('no overrides at all', () => {
  it('is byte-identical to the compiled bundles', () => {
    for (const source of [undefined, null, {} as PermissionOverrides])
      for (const role of ROLES)
        expect(resolvePermissions(role, source), role).toEqual(
          PERMISSIONS.filter((p: Permission) => isDefaultPermission(role, p)),
        )
  })
})
