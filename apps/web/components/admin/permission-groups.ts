import type { Permission } from '@palscans/core/permissions'

/**
 * How the 22 permissions are laid out on `Admin → Access → Roles`.
 *
 * Structure, not copy — the group labels and the per-permission descriptions live in
 * `adminMessages.roles`. Every permission appears in exactly one group and every group is
 * rendered, which `permission-groups.test.ts` asserts: a permission added to the code and
 * not to this list would otherwise be invisible on the one screen that explains them, and an
 * invisible permission is one an operator cannot grant or revoke.
 */
export const PERMISSION_GROUP_KEYS = [
  'panel',
  'catalogue',
  'chapters',
  'community',
  'accounts',
  'system',
] as const
export type PermissionGroupKey = (typeof PERMISSION_GROUP_KEYS)[number]

export const PERMISSION_GROUPS: Readonly<Record<PermissionGroupKey, readonly Permission[]>> = {
  panel: ['admin.access'],
  catalogue: ['series.read', 'series.create', 'series.update', 'series.delete', 'series.feature'],
  chapters: [
    'chapter.read',
    'chapter.create',
    'chapter.update',
    'chapter.delete',
    'chapter.publish',
    'chapter.repair',
  ],
  community: ['comment.moderate', 'report.handle', 'announcement.write'],
  accounts: ['user.read', 'user.update', 'user.ban', 'user.role', 'entitlement.grant'],
  system: ['settings.write', 'audit.read'],
}
