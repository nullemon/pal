import {
  type Permission,
  type PermissionOverrides,
  pruneOverrides,
  type Role,
  resolvePermissions,
} from '@palscans/core'
import { getDb, getSetting, settings } from '@palscans/db'
import { z } from 'zod'

/**
 * The operator's edits to the role × permission matrix (`Admin → Access → Roles`).
 *
 * Stored as one sparse JSON document in `settings.role_permissions` — the same table and the
 * same shape as every other admin-editable document (`site`, `ads`, `access`, `home_layout`).
 * A dedicated table would buy per-cell rows nobody queries individually and a migration to
 * maintain; the audit trail this screen needs lives in `audit_log` either way.
 *
 * **The caching rule is the load-bearing part.** `can()` runs many times per request, and
 * `loadSessionUser()` runs once per request, so the matrix is read once per process every
 * {@link OVERRIDES_TTL_MS} and resolved into `SessionUser.permissions` at session load. No
 * permission check ever touches the database, and the number of extra queries a request can
 * cause is zero. The price is a bounded staleness window: a revoke made on one instance
 * takes effect on the others within the TTL. The instance that writes clears its own cache
 * immediately.
 */

export const ROLE_PERMISSIONS_SETTING_KEY = 'role_permissions'

/** How long a process trusts its copy of the matrix. Deliberately short: this is access control. */
export const OVERRIDES_TTL_MS = 15_000

/**
 * Parsed loosely on purpose, then narrowed by `pruneOverrides`: unknown roles and
 * permissions in a stored document (a rolled-back deploy, a hand-edited row) are dropped
 * rather than throwing, because a settings row that fails to parse must not be able to take
 * authorization down with it.
 */
export const permissionOverridesSchema = z.record(z.string(), z.record(z.string(), z.boolean()))

interface Cached {
  at: number
  value: PermissionOverrides
}

let cache: Cached | null = null
let inflight: Promise<PermissionOverrides> | null = null

const load = async (): Promise<PermissionOverrides> => {
  const db = await getDb()
  const raw = await getSetting<unknown>(db, ROLE_PERMISSIONS_SETTING_KEY, null)
  if (raw === null) return {}
  const parsed = permissionOverridesSchema.safeParse(raw)
  return pruneOverrides(parsed.success ? (parsed.data as PermissionOverrides) : {})
}

/**
 * The stored overrides, memoised per process for {@link OVERRIDES_TTL_MS}.
 *
 * On a read failure the last known copy is served rather than an empty one: falling back to
 * "no overrides" would silently restore a permission the operator revoked, which is the one
 * failure mode this must not have. With no copy at all (first read of a cold process) the
 * compiled defaults stand — the same behaviour as a deployment that never configured
 * anything.
 */
export const readPermissionOverrides = async (
  now: number = Date.now(),
): Promise<PermissionOverrides> => {
  if (cache && now - cache.at < OVERRIDES_TTL_MS) return cache.value
  if (inflight) return inflight
  inflight = load()
    .then((value) => {
      cache = { at: Date.now(), value }
      return value
    })
    .catch(() => cache?.value ?? {})
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Drop this process's copy — called by the route that writes the matrix. */
export const invalidatePermissionOverrides = (): void => {
  cache = null
}

/** The effective permissions of a role, with the operator's configuration applied. */
export const permissionsForRole = async (role: Role): Promise<Permission[]> =>
  resolvePermissions(role, await readPermissionOverrides())

/** Persist a pruned override document. Returns what was actually written. */
export const writePermissionOverrides = async (
  next: PermissionOverrides,
  actorId: number,
): Promise<PermissionOverrides> => {
  const value = pruneOverrides(next)
  const db = await getDb()
  const now = new Date()
  await db
    .insert(settings)
    .values({ key: ROLE_PERMISSIONS_SETTING_KEY, value, updatedBy: actorId, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: actorId, updatedAt: now },
    })
  invalidatePermissionOverrides()
  return value
}
