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
  /**
   * The role's permissions as an operator has configured them (`Admin → Access → Roles`),
   * resolved once when the session is loaded and carried on the user for the rest of the
   * request — `can()` stays a synchronous array lookup, not a query.
   *
   * **Absent means "use the bundle above".** Anything that builds a `SessionUser` by hand —
   * the worker, a test, a script — therefore gets exactly today's behaviour, and so does a
   * deployment that has never opened the screen.
   */
  permissions?: readonly Permission[]
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
  !!u && (u.permissions ?? ROLE_PERMISSIONS[u.role]).includes(p)

/** The compiled bundle for a role — the default, before any operator configuration. */
export const permissionsFor = (role: Role): readonly Permission[] => ROLE_PERMISSIONS[role]

/* ------------------------------------------------------------------ operator overrides */

/**
 * An operator's edits to the matrix, as a **sparse** map of the cells they changed.
 *
 * Sparse is the whole design. A full stored matrix would freeze the six bundles at the
 * moment somebody first opened the screen: a permission added to the code later would be
 * absent from every stored role and so denied to everybody, silently, including the admin
 * who added it. Storing only the differences means an unset cell always reads from
 * `ROLE_PERMISSIONS`, so new permissions arrive with the default the code gave them.
 */
export type PermissionOverrides = Partial<Record<Role, Partial<Record<Permission, boolean>>>>

/**
 * Cells the matrix refuses to change, whatever is stored.
 *
 * `admin.access` opens the panel and `settings.write` gates `Admin → Access → Roles` and its
 * API. Revoking either from `admin` locks the last account that could undo it out of the
 * screen that did it, and the only way back would be SQL — which is the exact situation this
 * feature exists to remove. They are held true for `admin` in `grants()` below, so a stored
 * `false` (hand-edited row, restored backup, a bug) cannot take effect either.
 */
export const LOCKED_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  user: [],
  supporter: [],
  premium: [],
  uploader: [],
  moderator: [],
  admin: ['admin.access', 'settings.write'],
}

export const isLockedPermission = (role: Role, permission: Permission): boolean =>
  LOCKED_PERMISSIONS[role].includes(permission)

/** Whether the compiled bundle grants this cell, before any override. */
export const isDefaultPermission = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission)

/** One cell of the resolved matrix: locked wins, then the override, then the compiled default. */
export const grants = (
  role: Role,
  permission: Permission,
  overrides?: PermissionOverrides | null,
): boolean =>
  isLockedPermission(role, permission) ||
  (overrides?.[role]?.[permission] ?? isDefaultPermission(role, permission))

/** A role's effective permission list — what `SessionUser.permissions` is set from. */
export const resolvePermissions = (
  role: Role,
  overrides?: PermissionOverrides | null,
): Permission[] => PERMISSIONS.filter((p) => grants(role, p, overrides))

/**
 * Normalise a submitted matrix into what may be stored: unknown roles and permissions are
 * dropped, locked cells are dropped (they are not the operator's to set), and so is any cell
 * that merely restates the compiled default — the stored document stays a list of genuine
 * differences, and a role with no differences leaves no key behind at all.
 */
export const pruneOverrides = (input: PermissionOverrides | null | undefined) => {
  const out: PermissionOverrides = {}
  for (const role of ROLES) {
    const row = input?.[role]
    if (!row) continue
    const kept: Partial<Record<Permission, boolean>> = {}
    for (const permission of PERMISSIONS) {
      const value = row[permission]
      if (typeof value !== 'boolean') continue
      if (isLockedPermission(role, permission)) continue
      if (value === isDefaultPermission(role, permission)) continue
      kept[permission] = value
    }
    if (Object.keys(kept).length > 0) out[role] = kept
  }
  return out
}

export interface PermissionChange {
  role: Role
  permission: Permission
  before: boolean
  after: boolean
}

/** Every cell whose resolved answer differs between two override documents. */
export const permissionChanges = (
  before: PermissionOverrides | null | undefined,
  after: PermissionOverrides | null | undefined,
): PermissionChange[] => {
  const changes: PermissionChange[] = []
  for (const role of ROLES)
    for (const permission of PERMISSIONS) {
      const was = grants(role, permission, before)
      const now = grants(role, permission, after)
      if (was !== now) changes.push({ role, permission, before: was, after: now })
    }
  return changes
}
