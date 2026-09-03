import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// `unstable_cache` needs a Next request to hang its incremental cache on. The store's caching
// is not what these tests are about, so it is replaced by calling straight through.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => undefined,
}))

// Set before anything imports the db client: these tests exercise the real store against an
// in-memory Postgres, because the mask rule only means something end to end.
process.env.DATABASE_URL = 'pglite://memory'
process.env.CREDENTIALS_KEY = 'test-credentials-key-0123456789'
process.env.S3_BUCKET = 'bucket-from-the-environment'

const { getDbHandle, runMigrations } = await import('@palscans/db')
const { resetEnv } = await import('@palscans/core')
const { groupStatus, integrationsPutSchema, integrationsTestSchema } = await import('./panel')
const { SECRET_MASK } = await import('./registry')
const { configView, writeConfig } = await import('./store')

beforeAll(async () => {
  resetEnv()
  await runMigrations(await getDbHandle())
  // Rows record who wrote them, so there has to be someone to point at.
  const { getDb, users } = await import('@palscans/db')
  const db = await getDb()
  await db.insert(users).values({ email: 'operator@palscans.test', role: 'admin' })
}, 120_000)

afterAll(async () => {
  const { closeDb } = await import('@palscans/db')
  await closeDb()
})

/**
 * `configView()` reads through `unstable_cache`, which is not running in a Next request here.
 * The rows themselves are what these tests are about, so they are read back directly.
 */
const stored = async (): Promise<Record<string, string>> => {
  const { appCredentials, getDb } = await import('@palscans/db')
  const { open } = await import('@palscans/core')
  const db = await getDb()
  const rows = await db.select().from(appCredentials)
  return Object.fromEntries(rows.map((r) => [r.key, open(r.sealed) ?? '(unreadable)']))
}

describe('the submitted payload', () => {
  it('refuses an id that is not in the registry', () => {
    const parsed = integrationsPutSchema.safeParse({
      values: { 's3.bucket': 'ok', 'evil.injected': 'x' },
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toContain('evil.injected')
    expect(parsed.error?.issues[0]?.path).toEqual(['values', 'evil.injected'])
  })

  it('accepts every id that is', () => {
    expect(
      integrationsPutSchema.safeParse({
        values: { 's3.bucket': 'palscans', 'storage.driver': 's3' },
      }).success,
    ).toBe(true)
  })

  it('holds each value to what its kind promises', () => {
    const bad = (values: Record<string, string>) =>
      integrationsPutSchema.safeParse({ values }).success
    expect(bad({ 'storage.driver': 'ftp' })).toBe(false)
    expect(bad({ 'storage.public_cdn_url': 'not a url' })).toBe(false)
    expect(bad({ 'email.smtp_port': 'eight' })).toBe(false)
    expect(bad({ 's3.force_path_style': 'yes' })).toBe(false)
    expect(bad({ 'storage.driver': '' })).toBe(true) // clearing is always allowed
    expect(bad({ 'storage.public_cdn_url': 'https://cdn.example.org' })).toBe(true)
  })

  it('lets a masked secret through untouched — it is what the browser was given', () => {
    expect(
      integrationsPutSchema.safeParse({ values: { 's3.secret_access_key': SECRET_MASK } }).success,
    ).toBe(true)
  })

  it('rejects an unknown group on a connection test', () => {
    expect(integrationsTestSchema.safeParse({ group: 'nope', values: {} }).success).toBe(false)
    expect(integrationsTestSchema.safeParse({ group: 'storage', values: {} }).success).toBe(true)
  })
})

describe('writing values', () => {
  it('stores a value and reports it as coming from the panel', async () => {
    await writeConfig({ 's3.bucket': 'from-the-panel' }, 1)
    expect((await stored())['s3.bucket']).toBe('from-the-panel')
  })

  it('clears a value by deleting the row, so the environment takes over again', async () => {
    await writeConfig({ 's3.bucket': 'from-the-panel' }, 1)
    await writeConfig({ 's3.bucket': '' }, 1)
    expect(await stored()).not.toHaveProperty('s3.bucket')
    const view = await configView()
    const field = view.fields.find((f) => f.id === 's3.bucket')
    expect(field?.source).toBe('env')
    expect(field?.value).toBe('bucket-from-the-environment')
  })

  it('ignores an id that is not in the registry rather than storing it', async () => {
    await writeConfig({ 'evil.injected': 'x' }, 1)
    expect(await stored()).not.toHaveProperty('evil.injected')
  })
})

describe('secrets', () => {
  it('never leaves the server — the panel is given a mask instead', async () => {
    await writeConfig({ 's3.secret_access_key': 'the-real-key' }, 1)
    const view = await configView()
    const field = view.fields.find((f) => f.id === 's3.secret_access_key')
    expect(field?.value).toBe(SECRET_MASK)
    expect(field?.source).toBe('panel')
    expect(JSON.stringify(view)).not.toContain('the-real-key')
  })

  it('keeps the stored value when the mask comes back unchanged', async () => {
    await writeConfig({ 's3.secret_access_key': 'the-real-key' }, 1)
    // Exactly what a save with the field untouched submits.
    const changed = await writeConfig({ 's3.secret_access_key': SECRET_MASK }, 1)
    expect(changed).toEqual([])
    expect((await stored())['s3.secret_access_key']).toBe('the-real-key')
  })

  it('replaces the stored value when a real one is submitted', async () => {
    await writeConfig({ 's3.secret_access_key': 'the-real-key' }, 1)
    await writeConfig({ 's3.secret_access_key': 'a-newer-key' }, 1)
    expect((await stored())['s3.secret_access_key']).toBe('a-newer-key')
  })

  it('removes it when the field is emptied', async () => {
    await writeConfig({ 's3.secret_access_key': 'the-real-key' }, 1)
    await writeConfig({ 's3.secret_access_key': '' }, 1)
    expect(await stored()).not.toHaveProperty('s3.secret_access_key')
  })

  it('is sealed in the row, not stored as plain text', async () => {
    await writeConfig({ 's3.secret_access_key': 'the-real-key' }, 1)
    const { appCredentials, getDb } = await import('@palscans/db')
    const db = await getDb()
    const [row] = await db.select().from(appCredentials)
    expect(Buffer.from(row?.sealed ?? new Uint8Array()).toString('utf8')).not.toContain(
      'the-real-key',
    )
  })
})

describe('group status', () => {
  it('calls the local storage driver configured, because it needs no credentials', () => {
    expect(groupStatus('storage', { 'storage.driver': 'fs' }).state).toBe('ready')
  })

  it('asks S3 for the whole set before calling it configured', () => {
    const half = groupStatus('storage', { 'storage.driver': 's3', 's3.bucket': 'b' })
    expect(half.state).toBe('partial')
    expect(half.missing).toContain('s3.secret_access_key')
    expect(
      groupStatus('storage', {
        'storage.driver': 's3',
        'storage.public_cdn_url': 'https://cdn.example.org',
        's3.endpoint': 'https://x.r2.cloudflarestorage.com',
        's3.bucket': 'b',
        's3.access_key_id': 'k',
        's3.secret_access_key': SECRET_MASK,
      }).state,
    ).toBe('ready')
  })

  it('takes either OAuth provider on its own', () => {
    expect(
      groupStatus('oauth', {
        'oauth.google_client_id': 'id',
        'oauth.google_client_secret': SECRET_MASK,
      }).state,
    ).toBe('ready')
    expect(groupStatus('oauth', { 'oauth.google_client_id': 'id' }).state).toBe('partial')
    expect(groupStatus('oauth', {}).state).toBe('off')
  })

  it('takes either way of sending mail', () => {
    expect(
      groupStatus('email', { 'email.from': 'a@b.c', 'email.resend_api_key': SECRET_MASK }).state,
    ).toBe('ready')
    expect(
      groupStatus('email', {
        'email.from': 'a@b.c',
        'email.smtp_host': 'smtp.example.org',
        'email.smtp_port': '587',
        'email.smtp_user': 'u',
      }).state,
    ).toBe('ready')
  })
})
