import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The precedence rule, end to end against a real database (docs/19): a value stored in
 * `app_credentials` wins, and with nothing stored the environment variable that works today
 * still works. Every consumer rewired onto the store rests on this.
 *
 * `unstable_cache` is replaced by calling straight through — it needs a Next request to hang
 * its incremental cache on, and a cache in front of the read is not the rule under test.
 */
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => undefined,
}))

// Set before anything imports the db client or the environment.
process.env.DATABASE_URL = 'pglite://memory'
process.env.CREDENTIALS_KEY = 'test-credentials-key-0123456789'

const { appCredentials, closeDb, getDb, getDbHandle, runMigrations, users } = await import(
  '@palscans/db'
)
const { open, resetEnv, seal } = await import('@palscans/core')
const { configValue, resolveConfig, writeConfig } = await import('./store')

/** The signed-in admin every stored row points at. */
const OPERATOR = 1

beforeAll(async () => {
  resetEnv()
  await runMigrations(await getDbHandle())
  const db = await getDb()
  await db.insert(users).values({ email: 'operator@palscans.test', role: 'admin' })
}, 120_000)

afterAll(async () => {
  await closeDb()
})

beforeEach(async () => {
  const db = await getDb()
  await db.delete(appCredentials)
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.VAPID_PUBLIC_KEY
})

describe('panel over environment', () => {
  it('reads the environment variable when nothing is stored', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_from_env'
    const { values, sources } = await resolveConfig()
    expect(values['payments.stripe_secret_key']).toBe('sk_from_env')
    expect(sources['payments.stripe_secret_key']).toBe('env')
    expect(await configValue('payments.stripe_secret_key')).toBe('sk_from_env')
  })

  it('prefers the stored value over the environment', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_from_env'
    await writeConfig({ 'payments.stripe_secret_key': 'sk_from_panel' }, OPERATOR)
    const { values, sources } = await resolveConfig()
    expect(values['payments.stripe_secret_key']).toBe('sk_from_panel')
    expect(sources['payments.stripe_secret_key']).toBe('panel')
  })

  it('falls back again when the stored value is cleared', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_from_env'
    await writeConfig({ 'payments.stripe_secret_key': 'sk_from_panel' }, OPERATOR)
    // An empty submission deletes the row rather than storing "".
    await writeConfig({ 'payments.stripe_secret_key': '' }, OPERATOR)
    expect(await configValue('payments.stripe_secret_key')).toBe('sk_from_env')
    expect((await resolveConfig()).sources['payments.stripe_secret_key']).toBe('env')
  })

  it('reports a key neither source has as unset, without throwing', async () => {
    const { values, sources } = await resolveConfig()
    expect(values['payments.stripe_secret_key']).toBe('')
    expect(sources['payments.stripe_secret_key']).toBe('unset')
  })

  it('treats a row it cannot unseal as absent so the environment takes over', async () => {
    process.env.VAPID_PUBLIC_KEY = 'vapid_from_env'
    const db = await getDb()
    // What a rotated CREDENTIALS_KEY leaves behind: ciphertext this process cannot open.
    await db.insert(appCredentials).values({
      key: 'push.vapid_public_key',
      sealed: seal('vapid_from_panel', {
        ...process.env,
        CREDENTIALS_KEY: 'a-completely-different-key-here',
      }),
      isSecret: false,
      updatedAt: new Date(),
      updatedBy: OPERATOR,
    })
    expect(open((await db.select().from(appCredentials))[0]?.sealed ?? new Uint8Array())).toBeNull()
    expect(await configValue('push.vapid_public_key')).toBe('vapid_from_env')
  })
})
