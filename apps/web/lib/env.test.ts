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
