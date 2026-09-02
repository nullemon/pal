/**
 * Roles are bundles of permissions. Code checks permissions, never roles
 * (docs/04-admin-panel.md).
 */
export const ROLES = ['user', 'supporter', 'premium', 'uploader', 'moderator', 'admin'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  'admin.access',
  'series.read',
  'series.create',
  'series.update',
  'series.delete',
  'series.feature',
  'chapter.read',
  'chapter.create',
  'chapter.update',
  'chapter.delete',
  'chapter.publish',
  'chapter.repair', // replace pages on an existing chapter, nothing else
  'comment.moderate',
  'user.read',
  'user.update',
  'user.ban',
  'user.role',
  'report.handle',
  'announcement.write',
  'entitlement.grant',
  'settings.write',
  'audit.read',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  user: [],
  supporter: [],
  premium: [],
  uploader: [
    'admin.access',
    'series.read',
    'chapter.read',
    'chapter.create',
    'chapter.update',
    'chapter.repair',
  ],
  moderator: [
    'admin.access',
    'series.read',
    'series.update',
    'chapter.read',
    'chapter.update',
    'chapter.publish',
    'chapter.repair',
    'comment.moderate',
    'user.read',
    'user.ban',
    'report.handle',
  ],
  admin: PERMISSIONS,
}

/** The minimal shape of the signed-in user that authorization needs. */
export interface SessionUser {
  id: number
  role: Role
  username?: string | null
  email?: string
  emailVerifiedAt?: Date | null
  /** Active entitlement rows (see entitlements.ts). Optional so callers can pass a lean user. */
  entitlements?: readonly EntitlementRow[]
}

export interface EntitlementRow {
  feature: string
  expires_at: Date | null
}

export const STAFF_ROLES: readonly Role[] = ['moderator', 'admin']

export const isStaff = (u: SessionUser | null | undefined): boolean =>
  !!u && STAFF_ROLES.includes(u.role)

export const isStaffRole = (role: Role): boolean => STAFF_ROLES.includes(role)

/**
 * Whether `actor` may take a user-level action (ban, shadow-ban, comment-ban, warn, role
 * change, revocation) against an account holding `targetRole`. Holding `user.ban` is not
 * enough on its own: staff accounts can only be acted on by an admin, so a moderator can
 * never lock out an admin or another moderator. Self-checks stay with the caller.
 */
export const canActOn = (actor: SessionUser | null | undefined, targetRole: Role): boolean =>
  !!actor && (!isStaffRole(targetRole) || actor.role === 'admin')

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value)

export const isPermission = (value: unknown): value is Permission =>
  typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value)

export const can = (u: SessionUser | null | undefined, p: Permission): boolean =>
  !!u && ROLE_PERMISSIONS[u.role].includes(p)

export const permissionsFor = (role: Role): readonly Permission[] => ROLE_PERMISSIONS[role]
