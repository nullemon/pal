import { beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_URL = 'pglite://memory'

import { resetEnv } from '@palscans/core'
import {
  createInvite,
  emailAllowed,
  emailDomain,
  generateInviteCode,
  inviteCodeSchema,
  inviteState,
  inviteUsable,
  listInvites,
  normaliseDomain,
  normaliseDomains,
  redeemInvite,
  revokeInvite,
} from './invites'

/* ------------------------------------------------------------- domain rules */

const at = (n: number) => new Date(Date.UTC(2026, 0, 1, n))

describe('domain rules', () => {
  it('normalises what an operator actually types', () => {
    expect(normaliseDomain('  @Example.COM. ')).toBe('example.com')
    expect(normaliseDomain('.mail.example.com')).toBe('mail.example.com')
    expect(normaliseDomains(['a.com', ' A.COM ', '', '@b.com'])).toEqual(['a.com', 'b.com'])
    expect(emailDomain('Reader@Example.COM')).toBe('example.com')
  })

  it('lets everyone through while the mode is off', () => {
    expect(emailAllowed('a@spam.example', { domain_mode: 'off', domains: ['spam.example'] })).toBe(
      true,
    )
  })

  it('treats an empty list as off rather than locking the site out', () => {
    expect(emailAllowed('a@anything.test', { domain_mode: 'allow', domains: [] })).toBe(true)
    expect(emailAllowed('a@anything.test', { domain_mode: 'allow', domains: ['  '] })).toBe(true)
  })

  it('allow list admits only the listed domains and their subdomains', () => {
    const rules = { domain_mode: 'allow' as const, domains: ['example.com'] }
    expect(emailAllowed('reader@example.com', rules)).toBe(true)
    expect(emailAllowed('reader@MAIL.Example.com', rules)).toBe(true)
    expect(emailAllowed('reader@other.test', rules)).toBe(false)
    // A suffix that is not a subdomain must not match.
    expect(emailAllowed('reader@notexample.com', rules)).toBe(false)
  })

  it('block list refuses the listed domains and their subdomains', () => {
    const rules = { domain_mode: 'block' as const, domains: ['spam.example', 'mailinator.com'] }
    expect(emailAllowed('a@spam.example', rules)).toBe(false)
    expect(emailAllowed('a@x.spam.example', rules)).toBe(false)
    expect(emailAllowed('a@mailinator.com', rules)).toBe(false)
    expect(emailAllowed('a@example.com', rules)).toBe(true)
  })

  it('refuses an address with no domain at all', () => {
    expect(emailAllowed('nonsense', { domain_mode: 'allow', domains: ['example.com'] })).toBe(false)
  })
})

/* ------------------------------------------------------- invite state machine */

const invite = (over: Partial<Parameters<typeof inviteState>[0]> = {}) => ({
  uses: 0,
  maxUses: 1,
  expiresAt: null,
  revokedAt: null,
  ...over,
})

describe('inviteState', () => {
  it('is active while it has uses left and no expiry has passed', () => {
    expect(inviteState(invite(), at(0))).toBe('active')
    expect(inviteState(invite({ maxUses: 5, uses: 4 }), at(0))).toBe('active')
    expect(inviteState(invite({ expiresAt: at(2) }), at(1))).toBe('active')
  })
  it('is used up once the count reaches the maximum', () => {
    expect(inviteState(invite({ uses: 1 }), at(0))).toBe('used')
    expect(inviteState(invite({ maxUses: 5, uses: 5 }), at(0))).toBe('used')
  })
  it('expires exactly on its expiry, not after it', () => {
    expect(inviteState(invite({ expiresAt: at(1) }), at(1))).toBe('expired')
    expect(inviteState(invite({ expiresAt: at(1) }), at(2))).toBe('expired')
  })
  it('reports revoked ahead of everything else', () => {
    expect(inviteState(invite({ revokedAt: at(0), uses: 9, expiresAt: at(0) }), at(1))).toBe(
      'revoked',
    )
    expect(inviteUsable(invite({ revokedAt: at(0) }), at(1))).toBe(false)
  })
})

describe('generateInviteCode', () => {
  it('is XXXX-XXXX from an alphabet with no look-alike characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode()
      expect(code).toMatch(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/,
      )
      expect(inviteCodeSchema.safeParse(code).success).toBe(true)
    }
  })
  it('is upper-cased and trimmed on the way in, so typing is forgiving', () => {
    expect(inviteCodeSchema.parse('  abcd-2345 ')).toBe('ABCD-2345')
    expect(inviteCodeSchema.safeParse('nope!').success).toBe(false)
  })
})

/* -------------------------------------------------- lifecycle, against PGlite */

describe('invite lifecycle', () => {
  let actorId = 0
  beforeAll(async () => {
    resetEnv()
    const { getDb, getDbHandle, runMigrations, users } = await import('@palscans/db')
    await runMigrations(await getDbHandle())
    const [actor] = await (await getDb())
      .insert(users)
      .values({ email: 'operator@palscans.test' })
      .returning({ id: users.id })
    actorId = actor?.id ?? 0
  }, 120_000)

  it('creates a usable code, counts each redemption and stops at the limit', async () => {
    const row = await createInvite({ maxUses: 2, expiresAt: null, note: 'launch' }, actorId)
    expect(row.uses).toBe(0)
    expect(inviteUsable(row)).toBe(true)

    const first = await redeemInvite(row.code)
    expect(first?.uses).toBe(1)
    const second = await redeemInvite(row.code)
    expect(second?.uses).toBe(2)
    // The `uses < max_uses` guard lives in the UPDATE, so the third attempt claims nothing.
    expect(await redeemInvite(row.code)).toBeNull()
    expect(inviteState({ ...(second ?? row) })).toBe('used')
  })

  it('refuses a revoked code, and revoking twice is not an error the second time', async () => {
    const row = await createInvite({ maxUses: 10, expiresAt: null, note: null }, actorId)
    expect(await revokeInvite(row.id)).not.toBeNull()
    expect(await redeemInvite(row.code)).toBeNull()
    // Revoked, never deleted: the row is still listed with its history.
    expect(await revokeInvite(row.id)).toBeNull()
    const listed = (await listInvites()).find((i) => i.id === row.id)
    expect(listed?.revokedAt).not.toBeNull()
  })

  it('refuses an expired code', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const row = await createInvite({ maxUses: 10, expiresAt: past, note: null }, actorId)
    expect(await redeemInvite(row.code)).toBeNull()
  })

  it('matches the code case-insensitively, the way it is typed back in', async () => {
    const row = await createInvite({ maxUses: 1, expiresAt: null, note: null }, actorId)
    expect(await redeemInvite(row.code.toLowerCase())).not.toBeNull()
  })
})
