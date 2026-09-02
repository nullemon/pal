import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it('applies defaults and treats empty strings as unset', () => {
    const env = parseEnv({ NODE_ENV: 'test', REDIS_URL: '' })
    expect(env.STORAGE_DRIVER).toBe('fs')
    expect(env.STORAGE_FS_ROOT).toBe('./.data/storage')
    expect(env.REDIS_URL).toBeUndefined()
    expect(env.SITE_NAME).toBe('PALScans')
  })

  it('trusts no proxy header unless configured', () => {
    expect(parseEnv({ NODE_ENV: 'test' }).TRUSTED_PROXY).toBe('none')
    const env = parseEnv({ NODE_ENV: 'test', TRUSTED_PROXY: 'xff', TRUSTED_PROXY_HOPS: '2' })
    expect(env.TRUSTED_PROXY).toBe('xff')
    expect(env.TRUSTED_PROXY_HOPS).toBe(2)
    expect(() => parseEnv({ TRUSTED_PROXY: 'nginx' })).toThrow(/TRUSTED_PROXY/)
  })

  it('requires S3 settings for the s3 driver', () => {
    expect(() => parseEnv({ STORAGE_DRIVER: 's3' })).toThrow(/S3_ENDPOINT/)
  })

  it('rejects malformed values', () => {
    expect(() => parseEnv({ SITE_URL: 'not a url' })).toThrow(/SITE_URL/)
  })
})

describe('production secrets', () => {
  const secret = 'iyJPVHeoVwS9mx3qYyU+MJE8V2zIrZSc4UNZ0E5ewps='
  it('refuses the placeholder / short SESSION_SECRET and a missing INTERNAL_API_SECRET', () => {
    const proxy = { TRUSTED_PROXY: 'xff', SITE_URL: 'https://palscans.org' }
    expect(() => parseEnv({ NODE_ENV: 'production', INTERNAL_API_SECRET: 'x', ...proxy })).toThrow(
      /SESSION_SECRET/,
    )
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        SESSION_SECRET: 'short',
        INTERNAL_API_SECRET: 'x',
        ...proxy,
      }),
    ).toThrow(/SESSION_SECRET/)
    expect(() => parseEnv({ NODE_ENV: 'production', SESSION_SECRET: secret, ...proxy })).toThrow(
      /INTERNAL_API_SECRET/,
    )
    expect(
      parseEnv({
        NODE_ENV: 'production',
        SESSION_SECRET: secret,
        INTERNAL_API_SECRET: 'x',
        ...proxy,
      }).SESSION_SECRET,
    ).toBe(secret)
  })
  it('requires a declared proxy in production so rate limits are per client', () => {
    const base = {
      NODE_ENV: 'production',
      SESSION_SECRET: secret,
      INTERNAL_API_SECRET: 'x',
      SITE_URL: 'https://palscans.org',
    }
    expect(() => parseEnv(base)).toThrow(/TRUSTED_PROXY/)
    expect(() => parseEnv({ ...base, TRUSTED_PROXY: 'none' })).toThrow(/TRUSTED_PROXY/)
    expect(parseEnv({ ...base, TRUSTED_PROXY: 'cloudflare' }).TRUSTED_PROXY).toBe('cloudflare')
    // never enforced outside production
    expect(parseEnv({ NODE_ENV: 'development' }).TRUSTED_PROXY).toBe('none')
  })
  it('requires an https:// SITE_URL in production so auth cookies are Secure', () => {
    const base = {
      NODE_ENV: 'production',
      SESSION_SECRET: secret,
      INTERNAL_API_SECRET: 'x',
      TRUSTED_PROXY: 'xff',
    }
    // the .env.example default and an explicit http:// origin are both refused
    expect(() => parseEnv(base)).toThrow(/SITE_URL.*https/)
    expect(() => parseEnv({ ...base, SITE_URL: 'http://palscans.org' })).toThrow(/SITE_URL.*https/)
    expect(parseEnv({ ...base, SITE_URL: 'https://palscans.org' }).SITE_URL).toBe(
      'https://palscans.org',
    )
    // loopback is a secure context in browsers: a local `next start` on http keeps working
    expect(parseEnv({ ...base, SITE_URL: 'http://localhost:3200' }).SITE_URL).toBe(
      'http://localhost:3200',
    )
    expect(parseEnv({ ...base, SITE_URL: 'http://127.0.0.1:3200' }).SITE_URL).toBe(
      'http://127.0.0.1:3200',
    )
    expect(() => parseEnv({ ...base, SITE_URL: 'http://localhost.evil.org' })).toThrow(
      /SITE_URL.*https/,
    )
    // never enforced outside production
    expect(parseEnv({ NODE_ENV: 'development', SITE_URL: 'http://localhost:3000' }).SITE_URL).toBe(
      'http://localhost:3000',
    )
  })
  it('mirrors the storage/db knobs the core env reads', () => {
    const env = parseEnv({ NODE_ENV: 'test', DATABASE_POOL_MAX: '20', S3_FORCE_PATH_STYLE: 'true' })
    expect(env.DATABASE_POOL_MAX).toBe(20)
    expect(env.S3_FORCE_PATH_STYLE).toBe(true)
    expect(parseEnv({ NODE_ENV: 'test' }).DATABASE_POOL_MAX).toBeUndefined()
    expect(() => parseEnv({ NODE_ENV: 'test', DATABASE_POOL_MAX: '0' })).toThrow(
      /DATABASE_POOL_MAX/,
    )
  })
  it('does not apply the runtime checks during next build, nor outside production', () => {
    expect(
      parseEnv({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }).NODE_ENV,
    ).toBe('production')
    expect(parseEnv({ NODE_ENV: 'development' }).WORKER_PAGE_CONCURRENCY).toBe(4)
  })
})
