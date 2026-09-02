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
    expect(() => parseEnv({ NODE_ENV: 'production', INTERNAL_API_SECRET: 'x' })).toThrow(
      /SESSION_SECRET/,
    )
    expect(() =>
      parseEnv({ NODE_ENV: 'production', SESSION_SECRET: 'short', INTERNAL_API_SECRET: 'x' }),
    ).toThrow(/SESSION_SECRET/)
    expect(() => parseEnv({ NODE_ENV: 'production', SESSION_SECRET: secret })).toThrow(
      /INTERNAL_API_SECRET/,
    )
    expect(
      parseEnv({ NODE_ENV: 'production', SESSION_SECRET: secret, INTERNAL_API_SECRET: 'x' })
        .SESSION_SECRET,
    ).toBe(secret)
  })
  it('does not apply the runtime checks during next build, nor outside production', () => {
    expect(
      parseEnv({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }).NODE_ENV,
    ).toBe('production')
    expect(parseEnv({ NODE_ENV: 'development' }).WORKER_PAGE_CONCURRENCY).toBe(4)
  })
})
