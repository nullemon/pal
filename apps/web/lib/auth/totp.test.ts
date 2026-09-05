import { beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_URL = 'pglite://memory'
// `seal`/`open` read the process environment. A dedicated key here keeps the fixture
// independent of whatever SESSION_SECRET the machine running the suite happens to have.
process.env.CREDENTIALS_KEY = 'totp-test-credentials-key-0123456789abcdef'

import { open, seal } from '@palscans/core'
import { type Db, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import * as OTPAuth from 'otpauth'
import {
  consumeTotp,
  generateTotpSecret,
  TOTP_PERIOD_SEC,
  totpSecretColumns,
  totpSecretOf,
  totpStepFor,
  totpStepIsFresh,
} from './totp'

/**
 * The two pre-launch findings against TOTP, asserted rather than described.
 *
 * 1. **A code was replayable.** `verifyTotp` accepted the current 30-second step and one
 *    either side and recorded nothing, so the same six digits worked for up to ~90 seconds.
 * 2. **The secret was stored as raw base32.** A database dump handed over working second
 *    factors. It is sealed now — and the rows enrolled before that still open, which is the
 *    half of this that had to not break every enrolled admin's sign-in.
 */

const SECRET = generateTotpSecret()
const codeAt = (secret: string, at: number) =>
  new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD_SEC,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate({ timestamp: at })

/** A fixed instant, mid-step, so a test never straddles a period boundary by accident. */
const T0 = Date.UTC(2026, 5, 1, 12, 0, 15)
const step = (at: number) => Math.floor(at / 1000 / TOTP_PERIOD_SEC)

describe('reading a code', () => {
  it('names the absolute step a code belongs to', () => {
    expect(totpStepFor(SECRET, codeAt(SECRET, T0), 'a@b.test', T0)).toBe(step(T0))
  })

  it('still accepts one step of drift either side, and says which step that was', () => {
    const period = TOTP_PERIOD_SEC * 1000
    expect(totpStepFor(SECRET, codeAt(SECRET, T0 - period), 'a@b.test', T0)).toBe(step(T0) - 1)
    expect(totpStepFor(SECRET, codeAt(SECRET, T0 + period), 'a@b.test', T0)).toBe(step(T0) + 1)
    // Two steps out is outside the window.
    expect(totpStepFor(SECRET, codeAt(SECRET, T0 + 2 * period), 'a@b.test', T0)).toBeNull()
  })

  it('refuses a wrong code and a code for another secret', () => {
    expect(totpStepFor(SECRET, '000000', 'a@b.test', T0)).toBeNull()
    expect(totpStepFor(SECRET, codeAt(generateTotpSecret(), T0), 'a@b.test', T0)).toBeNull()
  })

  it('spends a step exactly once', () => {
    expect(totpStepIsFresh(100, null)).toBe(true)
    expect(totpStepIsFresh(100, 99)).toBe(true)
    expect(totpStepIsFresh(100, 100)).toBe(false) // the replay
    expect(totpStepIsFresh(99, 100)).toBe(false) // the older half of the drift window
    expect(totpStepIsFresh(null, null)).toBe(false)
  })
})

describe('the secret at rest', () => {
  it('seals what it stores and never leaves the plaintext behind', () => {
    const columns = totpSecretColumns(SECRET)
    expect(columns.totpSecret).toBeNull()
    expect(open(columns.totpSecretSealed)).toBe(SECRET)
    // The ciphertext must not contain the base32 anywhere in it.
    expect(Buffer.from(columns.totpSecretSealed).toString('latin1')).not.toContain(SECRET)
  })

  it('refuses to store one at all when there is no sealing key', () => {
    const key = process.env.CREDENTIALS_KEY
    const session = process.env.SESSION_SECRET
    process.env.CREDENTIALS_KEY = ''
    process.env.SESSION_SECRET = ''
    try {
      expect(() => totpSecretColumns(SECRET)).toThrow()
    } finally {
      process.env.CREDENTIALS_KEY = key
      if (session === undefined) delete process.env.SESSION_SECRET
      else process.env.SESSION_SECRET = session
    }
  })

  it('reads either column, and reads an unopenable one as no factor at all', () => {
    expect(totpSecretOf({ totpSecret: SECRET, totpSecretSealed: null })).toBe(SECRET)
    expect(totpSecretOf({ totpSecret: null, totpSecretSealed: seal(SECRET) })).toBe(SECRET)
    expect(totpSecretOf({ totpSecret: null, totpSecretSealed: null })).toBeNull()
    // Sealed wins even when a stale plaintext is still sitting beside it.
    expect(totpSecretOf({ totpSecret: 'STALE', totpSecretSealed: seal(SECRET) })).toBe(SECRET)
    // A rotated key: null, so the caller fails the code check. Callers must branch on
    // `totpEnabledAt`, never on this, or an unreadable secret reads as "no second factor".
    expect(totpSecretOf({ totpSecret: null, totpSecretSealed: new Uint8Array(64) })).toBeNull()
  })
})

describe('consuming a code against the database', () => {
  let db: Db

  const newUser = async (values: Partial<typeof users.$inferInsert> = {}): Promise<number> => {
    const [row] = await db
      .insert(users)
      .values({ email: `totp-${Math.random().toString(36).slice(2)}@palscans.test`, ...values })
      .returning({ id: users.id })
    return row?.id ?? 0
  }

  const rowFor = async (id: number) => {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    if (!row) throw new Error('user vanished')
    return row
  }

  beforeAll(async () => {
    const { resetEnv } = await import('@palscans/core')
    resetEnv()
    const { getDb, getDbHandle, runMigrations } = await import('@palscans/db')
    await runMigrations(await getDbHandle())
    db = await getDb()
  }, 120_000)

  it('accepts a correct code once and refuses the same one afterwards', async () => {
    const id = await newUser({ ...totpSecretColumns(SECRET), totpEnabledAt: new Date() })
    const code = codeAt(SECRET, T0)

    expect(await consumeTotp(id, await rowFor(id), code, 'a@b.test', T0)).toBe(true)
    expect(await rowFor(id).then((r) => r.totpLastStep)).toBe(step(T0))

    // The replay: same code, same drift window, a second later.
    expect(await consumeTotp(id, await rowFor(id), code, 'a@b.test', T0 + 1_000)).toBe(false)
    // And still refused from the far side of the window, where the code is still "valid".
    expect(
      await consumeTotp(id, await rowFor(id), code, 'a@b.test', T0 + TOTP_PERIOD_SEC * 1000),
    ).toBe(false)
  })

  it('refuses the older half of the drift window once a newer step is spent', async () => {
    const id = await newUser({ ...totpSecretColumns(SECRET), totpEnabledAt: new Date() })
    const previous = codeAt(SECRET, T0 - TOTP_PERIOD_SEC * 1000)
    expect(await consumeTotp(id, await rowFor(id), codeAt(SECRET, T0), 'a@b.test', T0)).toBe(true)
    expect(await consumeTotp(id, await rowFor(id), previous, 'a@b.test', T0)).toBe(false)
  })

  it('lets the next step through, so a real sign-in still works', async () => {
    const id = await newUser({ ...totpSecretColumns(SECRET), totpEnabledAt: new Date() })
    const later = T0 + TOTP_PERIOD_SEC * 1000
    expect(await consumeTotp(id, await rowFor(id), codeAt(SECRET, T0), 'a@b.test', T0)).toBe(true)
    expect(await consumeTotp(id, await rowFor(id), codeAt(SECRET, later), 'a@b.test', later)).toBe(
      true,
    )
  })

  it('only one of two requests racing with the same code wins', async () => {
    const id = await newUser({ ...totpSecretColumns(SECRET), totpEnabledAt: new Date() })
    const row = await rowFor(id)
    const code = codeAt(SECRET, T0)
    const results = await Promise.all([
      consumeTotp(id, row, code, 'a@b.test', T0),
      consumeTotp(id, row, code, 'a@b.test', T0),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('refuses a wrong code without spending anything', async () => {
    const id = await newUser({ ...totpSecretColumns(SECRET), totpEnabledAt: new Date() })
    expect(await consumeTotp(id, await rowFor(id), '000000', 'a@b.test', T0)).toBe(false)
    expect(await rowFor(id).then((r) => r.totpLastStep)).toBeNull()
    expect(await consumeTotp(id, await rowFor(id), codeAt(SECRET, T0), 'a@b.test', T0)).toBe(true)
  })

  it('refuses an account with no secret in either column', async () => {
    const id = await newUser({ totpEnabledAt: new Date() })
    expect(await consumeTotp(id, await rowFor(id), codeAt(SECRET, T0), 'a@b.test', T0)).toBe(false)
  })

  /**
   * The existing-rows path. A row enrolled before migration 9036 holds raw base32 and no
   * sealed column; the migration cannot encrypt it (the key is in the environment, not the
   * database), so the account must keep working and re-seal itself on first use.
   */
  it('signs in a pre-9036 plaintext enrolment and re-seals it in place', async () => {
    const id = await newUser({ totpSecret: SECRET, totpEnabledAt: new Date() })
    const before = await rowFor(id)
    expect(before.totpSecret).toBe(SECRET)
    expect(before.totpSecretSealed).toBeNull()

    expect(await consumeTotp(id, before, codeAt(SECRET, T0), 'a@b.test', T0)).toBe(true)

    const after = await rowFor(id)
    expect(after.totpSecret, 'the plaintext column is emptied by the upgrade').toBeNull()
    expect(after.totpSecretSealed).not.toBeNull()
    expect(open(after.totpSecretSealed as Uint8Array)).toBe(SECRET)
    expect(after.totpLastStep).toBe(step(T0))

    // And it is still the same authenticator afterwards: the next step signs in.
    const later = T0 + TOTP_PERIOD_SEC * 1000
    expect(await consumeTotp(id, after, codeAt(SECRET, later), 'a@b.test', later)).toBe(true)
  })
})
