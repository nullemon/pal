import { describe, expect, it } from 'vitest'
import {
  can,
  canActOn,
  grants,
  isDefaultPermission,
  isLockedPermission,
  isPermission,
  isRole,
  isStaff,
  LOCKED_PERMISSIONS,
  PERMISSIONS,
  type Permission,
  type PermissionOverrides,
  permissionChanges,
  pruneOverrides,
  ROLE_PERMISSIONS,
  ROLES,
  resolvePermissions,
} from '../permissions.js'

describe('canActOn', () => {
  const moderator = { id: 2, role: 'moderator' as const }
  const admin = { id: 1, role: 'admin' as const }
  it('refuses a moderator acting on staff (ban / shadow-ban / comment-ban an admin)', () => {
    expect(canActOn(moderator, 'admin')).toBe(false)
    expect(canActOn(moderator, 'moderator')).toBe(false)
  })
  it('lets a moderator act on regular members and an admin act on anyone', () => {
    expect(canActOn(moderator, 'user')).toBe(true)
    expect(canActOn(moderator, 'uploader')).toBe(true)
    expect(canActOn(admin, 'moderator')).toBe(true)
    expect(canActOn(admin, 'admin')).toBe(true)
    expect(canActOn(null, 'user')).toBe(false)
  })
})

describe('permissions', () => {
  it('matches docs/04 role bundles', () => {
    expect(ROLE_PERMISSIONS.user).toEqual([])
    expect(ROLE_PERMISSIONS.supporter).toEqual([])
    expect(ROLE_PERMISSIONS.premium).toEqual([])
    expect(ROLE_PERMISSIONS.uploader).toEqual([
      'admin.access',
      'series.read',
      'chapter.read',
      'chapter.create',
      'chapter.update',
      'chapter.repair',
    ])
    expect(ROLE_PERMISSIONS.moderator).toContain('chapter.publish')
    expect(ROLE_PERMISSIONS.uploader).not.toContain('chapter.publish')
    expect(ROLE_PERMISSIONS.admin).toBe(PERMISSIONS)
    expect(PERMISSIONS).toHaveLength(23)
  })

  it('can() checks permissions, never roles', () => {
    expect(can(null, 'admin.access')).toBe(false)
    expect(can(undefined, 'series.read')).toBe(false)
    expect(can({ id: 1, role: 'user' }, 'admin.access')).toBe(false)
    expect(can({ id: 1, role: 'uploader' }, 'chapter.create')).toBe(true)
    expect(can({ id: 1, role: 'uploader' }, 'chapter.publish')).toBe(false)
    expect(can({ id: 1, role: 'moderator' }, 'chapter.publish')).toBe(true)
    expect(can({ id: 1, role: 'moderator' }, 'user.role')).toBe(false)
    expect(can({ id: 1, role: 'admin' }, 'user.role')).toBe(true)
    for (const p of PERMISSIONS) expect(can({ id: 1, role: 'admin' }, p)).toBe(true)
  })

  it('guards', () => {
    expect(ROLES).toContain('supporter')
    expect(isRole('admin')).toBe(true)
    expect(isRole('root')).toBe(false)
    expect(isPermission('chapter.repair')).toBe(true)
    expect(isPermission('chapter.fly')).toBe(false)
    expect(isStaff({ id: 1, role: 'moderator' })).toBe(true)
    expect(isStaff({ id: 1, role: 'premium' })).toBe(false)
  })
})

/**
 * The operator-editable matrix (`Admin → Access → Roles`).
 *
 * Two properties carry the whole design and are asserted first: the admin role cannot be
 * locked out of the screen that edits it, and a cell nobody has touched answers from the
 * compiled bundle rather than from storage — which is what keeps a permission added in a
 * later release from being silently denied to every role.
 */
describe('permission overrides', () => {
  it('cannot lock the admin role out, whatever is stored', () => {
    const hostile: PermissionOverrides = {
      admin: { 'admin.access': false, 'settings.write': false, 'audit.read': false },
    }
    // The two gate permissions hold, however they were written.
    expect(grants('admin', 'admin.access', hostile)).toBe(true)
    expect(grants('admin', 'settings.write', hostile)).toBe(true)
    expect(
      can(
        { id: 1, role: 'admin', permissions: resolvePermissions('admin', hostile) },
        'admin.access',
      ),
    ).toBe(true)
    expect(
      can(
        { id: 1, role: 'admin', permissions: resolvePermissions('admin', hostile) },
        'settings.write',
      ),
    ).toBe(true)
    // Anything not on the locked list is the operator's to take away.
    expect(grants('admin', 'audit.read', hostile)).toBe(false)
    // …and a stored false for a locked cell is never persisted in the first place.
    expect(pruneOverrides(hostile)).toEqual({ admin: { 'audit.read': false } })
    expect(LOCKED_PERMISSIONS.admin).toEqual(['admin.access', 'settings.write'])
  })

  it('an unset cell falls back to the compiled default', () => {
    // Nothing configured at all: every cell of every role matches the shipped bundle.
    for (const role of ROLES)
      for (const permission of PERMISSIONS)
        expect(grants(role, permission, {})).toBe(ROLE_PERMISSIONS[role].includes(permission))
    for (const role of ROLES)
      expect(resolvePermissions(role, {})).toEqual([...ROLE_PERMISSIONS[role]])
    for (const role of ROLES)
      expect(resolvePermissions(role, null)).toEqual([...ROLE_PERMISSIONS[role]])

    // One cell configured: its neighbours are untouched.
    const overrides: PermissionOverrides = { moderator: { 'series.delete': true } }
    expect(grants('moderator', 'series.delete', overrides)).toBe(true)
    expect(grants('moderator', 'series.create', overrides)).toBe(false)
    expect(grants('moderator', 'comment.moderate', overrides)).toBe(true)
    expect(grants('uploader', 'series.delete', overrides)).toBe(false)
  })

  it('a permission the stored document has never heard of keeps its code default', () => {
    // The shape a document written before a permission existed has: no key for it anywhere.
    const older: PermissionOverrides = { uploader: { 'chapter.publish': true } }
    const untouched = PERMISSIONS.filter((p) => p !== 'chapter.publish')
    for (const p of untouched)
      expect(grants('uploader', p, older)).toBe(ROLE_PERMISSIONS.uploader.includes(p))
    expect(grants('uploader', 'chapter.publish', older)).toBe(true)
  })

  it('stores only genuine differences', () => {
    const restating: PermissionOverrides = {
      // Both of these are already the compiled default and leave no key behind.
      moderator: { 'comment.moderate': true, 'series.create': false },
      uploader: { 'chapter.publish': true },
    }
    expect(pruneOverrides(restating)).toEqual({ uploader: { 'chapter.publish': true } })
    expect(pruneOverrides({})).toEqual({})
    expect(pruneOverrides(null)).toEqual({})
    // Unknown roles and permissions in a stored document are dropped, not thrown on.
    const junk = { root: { 'series.read': true }, moderator: { 'chapter.fly': true } }
    expect(pruneOverrides(junk as PermissionOverrides)).toEqual({})
  })

  it('reports every cell whose answer changed', () => {
    const before: PermissionOverrides = { uploader: { 'chapter.publish': true } }
    const after: PermissionOverrides = { moderator: { 'user.role': true } }
    expect(permissionChanges(before, after)).toEqual([
      { role: 'uploader', permission: 'chapter.publish', before: true, after: false },
      { role: 'moderator', permission: 'user.role', before: false, after: true },
    ])
    expect(permissionChanges(before, before)).toEqual([])
    // A locked cell can never appear as a change.
    expect(permissionChanges({}, { admin: { 'admin.access': false } })).toEqual([])
  })

  it('`can` uses the resolved list when the session carries one, and the bundle otherwise', () => {
    const overrides: PermissionOverrides = { moderator: { 'user.ban': false, 'user.role': true } }
    const permissions = resolvePermissions('moderator', overrides)
    const configured = { id: 2, role: 'moderator' as const, permissions }
    const lean = { id: 2, role: 'moderator' as const }

    expect(can(configured, 'user.ban')).toBe(false)
    expect(can(configured, 'user.role')).toBe(true)
    // A user built without the resolved list — the worker, a script, a test — behaves as today.
    expect(can(lean, 'user.ban')).toBe(true)
    expect(can(lean, 'user.role')).toBe(false)
  })

  it('resolves in PERMISSIONS order and only ever contains real permissions', () => {
    const list: readonly Permission[] = resolvePermissions('admin', {
      admin: { 'audit.read': false },
    })
    expect(list).toEqual(PERMISSIONS.filter((p) => p !== 'audit.read'))
    expect(isLockedPermission('moderator', 'admin.access')).toBe(false)
    expect(isDefaultPermission('moderator', 'admin.access')).toBe(true)
  })
})
