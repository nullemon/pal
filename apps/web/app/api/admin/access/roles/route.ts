import {
  isAdminOnlyPermission,
  isLockedPermission,
  isPermission,
  isRole,
  type PermissionOverrides,
  permissionChanges,
  pruneOverrides,
} from '@palscans/core'
import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { audit } from '@/components/admin/server/audit'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'
import {
  permissionOverridesSchema,
  readPermissionOverrides,
  writePermissionOverrides,
} from '@/lib/auth/roles'

/**
 * `PUT /api/admin/access/roles` — the role × permission matrix.
 *
 * Gated on **`settings.write`**, which is also one of the two cells the matrix refuses to
 * revoke from `admin`: the screen cannot be used to close its own door.
 *
 * The body is the whole override document, not a delta, so a save is idempotent and two
 * operators cannot interleave into a state neither of them asked for. `pruneOverrides` drops
 * anything that is not a real difference from the compiled default, which is what keeps a
 * permission added in a later release on its code default rather than frozen at whatever the
 * matrix looked like the day somebody first opened this page.
 *
 * A fixed cell submitted against its fixed value is refused rather than quietly dropped —
 * `admin.access` / `settings.write` as `false` for `admin`, and `appearance.advanced` as
 * `true` for anyone else. The UI disables those checkboxes and says why; an API caller gets
 * the same reason instead of a silent no-op that would read as success.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, permissionOverridesSchema)
  if (!parsed.ok) return parsed.response
  const submitted = parsed.data as PermissionOverrides
  const m = adminMessages.roles

  for (const [role, row] of Object.entries(submitted)) {
    if (!isRole(role) || !row) continue
    for (const [permission, value] of Object.entries(row)) {
      if (!isPermission(permission)) continue
      if (value === false && isLockedPermission(role, permission))
        return fail(409, 'locked', fmt(m.lockedToast, { permission, role }))
      if (value === true && isAdminOnlyPermission(permission) && role !== 'admin')
        return fail(409, 'admin_only', fmt(m.adminOnlyBody, { permission, role }))
    }
  }

  const before = await readPermissionOverrides()
  const next = pruneOverrides(submitted)
  const changes = permissionChanges(before, next)
  if (changes.length === 0) return ok({ overrides: before, changes: [] })

  await writePermissionOverrides(next, user.id)

  // One entry per save, carrying one line per cell that changed — the audit viewer diffs
  // `before`/`after` key by key, so "moderator lost user.ban" shows as its own row.
  const asMap = (pick: 'before' | 'after') =>
    Object.fromEntries(
      changes.map((c) => [`${c.role}.${c.permission}`, c[pick] ? 'granted' : 'denied']),
    )
  await audit({
    actorId: user.id,
    action: 'access.roles',
    targetType: 'settings',
    before: asMap('before'),
    after: asMap('after'),
    request,
  })

  return ok({ overrides: next, changes })
})
