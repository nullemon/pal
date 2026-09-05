import { PERMISSIONS, type PermissionOverrides } from '@palscans/core'
import { adminMessages } from '@palscans/core/messages/admin'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSION_GROUP_KEYS, PERMISSION_GROUPS } from '@/components/admin/permission-groups'

/**
 * The read path behind `Admin → Access → Roles`.
 *
 * `loadSessionUser` calls `permissionsForRole` once per request, and `can()` is then a
 * synchronous array lookup — so what is actually worth testing here is the cache: that a
 * process reads the settings row once per TTL rather than once per session, that a write
 * invalidates it immediately, and that a failed read serves the last known matrix instead of
 * quietly falling back to "no overrides", which would restore a permission an operator had
 * revoked.
 */

const state = vi.hoisted(() => ({ value: null as unknown, reads: 0, fail: false }))

vi.mock('@palscans/db', () => ({
  getDb: async () => ({}),
  getSetting: async (_db: unknown, _key: string, fallback: unknown) => {
    state.reads += 1
    if (state.fail) throw new Error('database unavailable')
    return state.value ?? fallback
  },
  settings: { key: 'key' },
}))

const { OVERRIDES_TTL_MS, invalidatePermissionOverrides, readPermissionOverrides } = await import(
  './roles'
)

beforeEach(() => {
  state.value = null
  state.reads = 0
  state.fail = false
  invalidatePermissionOverrides()
})

describe('readPermissionOverrides', () => {
  it('reads the settings row once per TTL, not once per session', async () => {
    await readPermissionOverrides()
    await readPermissionOverrides()
    await readPermissionOverrides()
    expect(state.reads).toBe(1)

    await readPermissionOverrides(Date.now() + OVERRIDES_TTL_MS + 1)
    expect(state.reads).toBe(2)
  })

  it('an unconfigured deployment resolves to no overrides at all', async () => {
    expect(await readPermissionOverrides()).toEqual({})
  })

  it('prunes what it reads, so a stale document cannot deny a new permission', async () => {
    state.value = {
      moderator: { 'series.delete': true, 'comment.moderate': true },
      admin: { 'admin.access': false },
      root: { 'series.read': true },
      uploader: { 'chapter.fly': true },
    }
    // Restated defaults, the locked cell, the unknown role and the unknown permission all go.
    expect(await readPermissionOverrides()).toEqual({ moderator: { 'series.delete': true } })
  })

  it('a malformed row is ignored rather than taking authorization down', async () => {
    state.value = { moderator: 'everything' }
    expect(await readPermissionOverrides()).toEqual({})
  })

  it('serves the last known matrix when the read fails', async () => {
    state.value = { moderator: { 'series.delete': true } }
    const good = await readPermissionOverrides()
    expect(good).toEqual({ moderator: { 'series.delete': true } })

    state.fail = true
    const stale = await readPermissionOverrides(Date.now() + OVERRIDES_TTL_MS + 1)
    // Not `{}` — falling back to the compiled defaults would silently re-grant a revoked
    // permission, which is the one failure mode this must not have.
    expect(stale).toEqual({ moderator: { 'series.delete': true } })
  })
})

/**
 * The screen has to show every permission, because a permission it does not show is one an
 * operator cannot grant or revoke — and cannot even find out exists.
 */
describe('the matrix covers the code', () => {
  const listed = PERMISSION_GROUP_KEYS.flatMap((k) => [...PERMISSION_GROUPS[k]])

  it('puts every permission in exactly one group', () => {
    expect([...listed].sort()).toEqual([...PERMISSIONS].sort())
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('describes every permission in plain English', () => {
    const copy = adminMessages.roles.permissions as Record<string, string>
    for (const p of PERMISSIONS) {
      expect(copy[p], `${p} has no description`).toBeTruthy()
      // A sentence, not a restatement of the key.
      expect((copy[p] ?? '').length, `${p} reads like a placeholder`).toBeGreaterThan(15)
    }
  })
})

/** Type-level: the stored document is a partial map, never a full matrix. */
const _shape: PermissionOverrides = { moderator: { 'series.delete': true } }
void _shape
