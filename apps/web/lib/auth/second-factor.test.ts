import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canActOn } from '@palscans/core'
import { describe, expect, it } from 'vitest'

/**
 * Two authorization holes that shipped and were found in a pre-launch audit. Both are the
 * same shape: a check that looks right, asks a slightly different question than the one that
 * matters, and fails open. Guarded here so neither can quietly return.
 */
const web = join(import.meta.dirname, '../..')
const read = (p: string) => readFileSync(join(web, p), 'utf8')

describe('OAuth is one factor, not two', () => {
  const callback = read('app/api/auth/[provider]/callback/route.ts')

  it('demands the second factor before minting a session for an enrolled account', () => {
    // The password route branches on `totpEnabledAt && totpSecret` before `signIn`. The
    // OAuth callback did not, so a linked Google or Discord account was a one-factor door
    // into the admin panel — `adminTotpMissing()` only ever checked a factor was *enrolled*.
    expect(callback).toMatch(/totpEnabledAt/)
    expect(callback).toMatch(/setMfaChallenge\(/)
    const guard = callback.indexOf('setMfaChallenge(')
    const mint = callback.indexOf('await signIn(linkedRow.userId')
    expect(
      guard,
      'the second-factor branch must come before the session is minted',
    ).toBeGreaterThan(-1)
    expect(mint).toBeGreaterThan(guard)
  })

  it('selects the factor it branches on', () => {
    expect(callback).toMatch(/totpSecret: users\.totpSecret/)
  })
})

describe('a role change is checked against the role being granted', () => {
  it('asks canActOn about the new role, not only the current one', () => {
    for (const path of ['app/api/admin/users/[id]/route.ts', 'app/api/admin/users/bulk/route.ts']) {
      const src = read(path)
      // `canActOn(actor, target.role)` answers "may I touch this reader?" — yes. The question
      // that matters is "may I hand out admin?", which is `canActOn(actor, <the new role>)`.
      expect(src, path).toMatch(/canActOn\(actor, (body|action)\.role\)/)
    }
  })

  it('still refuses a moderator handing out admin', () => {
    const mod = { id: 1, role: 'moderator' as const, entitlements: [] }
    expect(canActOn(mod, 'admin')).toBe(false)
    expect(canActOn(mod, 'moderator')).toBe(false)
    expect(canActOn(mod, 'user')).toBe(true)
  })
})

describe('the comment viewer carries the operator permission matrix', () => {
  it('copies permissions out of the session', () => {
    // Without this, `can()` silently falls back to the compiled bundle: a revoked
    // `comment.moderate` still deleted other people's comments, and a granted one refused.
    expect(read('lib/comments/viewer.ts')).toMatch(/permissions: session\.permissions/)
  })
})
