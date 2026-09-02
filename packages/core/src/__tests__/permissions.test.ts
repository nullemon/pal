import { describe, expect, it } from 'vitest'
import {
  can,
  isPermission,
  isRole,
  isStaff,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
} from '../permissions.js'

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
    expect(PERMISSIONS).toHaveLength(22)
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
