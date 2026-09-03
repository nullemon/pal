import { credentialValue, resetEnv, storedCredentials } from '@palscans/core'
import { configureStorage, getStorage } from '@palscans/core/storage'
import type { Db } from '@palscans/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCredentialReader, installWorkerConfig, storageResolverFor } from './config.js'

/**
 * The worker's resolver (docs/19). Two things have to hold, and they are the two things a
 * missing test would let regress: the storage client is **rebuilt** when the operator changes
 * the bucket in the panel, and everything still falls back to the environment.
 *
 * `readSealedCredentials` is injected rather than mocked so this stays a unit test; the round
 * trip through a real `app_credentials` table is covered end to end in
 * `apps/web/lib/config/store.test.ts`, over the same shared reader.
 */

const db = {} as Db

/** A stand-in for the sealed rows, swappable between reads like an operator saving. */
let rows: Record<string, string>
let reads: number

const reader = (ttlMs = 0) =>
  createCredentialReader(db, {
    ttlMs,
    read: async () => {
      reads += 1
      return { ...rows }
    },
  })

beforeEach(() => {
  rows = {}
  reads = 0
  resetEnv()
  process.env.STORAGE_DRIVER = 'fs'
  process.env.STORAGE_FS_ROOT = '.data/storage-test'
  delete process.env.S3_BUCKET
  delete process.env.PUBLIC_CDN_URL
  delete process.env.DISCORD_BOT_TOKEN
})

afterEach(() => {
  configureStorage(undefined)
  resetEnv()
})

describe('the credential reader', () => {
  it('caches within the TTL and re-reads after it', async () => {
    let clock = 0
    const read = createCredentialReader(db, {
      ttlMs: 1_000,
      now: () => clock,
      read: async () => {
        reads += 1
        return { ...rows }
      },
    })
    rows = { 's3.bucket': 'first' }
    expect((await read())['s3.bucket']).toBe('first')
    rows = { 's3.bucket': 'second' }
    clock = 500
    expect((await read())['s3.bucket']).toBe('first')
    expect(reads).toBe(1)
    clock = 1_500
    expect((await read())['s3.bucket']).toBe('second')
    expect(reads).toBe(2)
  })

  it('keeps serving the last good read when the database goes away', async () => {
    let fail = false
    const read = createCredentialReader(db, {
      ttlMs: 0,
      read: async () => {
        if (fail) throw new Error('connection refused')
        return { 's3.bucket': 'live' }
      },
    })
    expect((await read())['s3.bucket']).toBe('live')
    fail = true
    expect((await read())['s3.bucket']).toBe('live')
  })

  it('yields nothing — not an error — when the very first read fails', async () => {
    const read = createCredentialReader(db, {
      ttlMs: 0,
      read: async () => {
        throw new Error('no such table: app_credentials')
      },
    })
    await expect(read()).resolves.toEqual({})
  })
})

describe('the storage resolver', () => {
  it('falls back to the environment with nothing stored', async () => {
    process.env.STORAGE_DRIVER = 's3'
    process.env.S3_BUCKET = 'bucket-from-env'
    process.env.S3_ENDPOINT = 'https://env.r2.cloudflarestorage.com'
    process.env.S3_ACCESS_KEY_ID = 'env-key'
    process.env.S3_SECRET_ACCESS_KEY = 'env-secret'
    resetEnv()
    const config = await storageResolverFor(reader())()
    expect(config.driver).toBe('s3')
    expect(config.s3?.bucket).toBe('bucket-from-env')
    expect(config.s3?.accessKeyId).toBe('env-key')
  })

  it('prefers the stored bucket over the environment', async () => {
    process.env.STORAGE_DRIVER = 's3'
    process.env.S3_BUCKET = 'bucket-from-env'
    process.env.S3_ENDPOINT = 'https://env.r2.cloudflarestorage.com'
    process.env.S3_ACCESS_KEY_ID = 'env-key'
    process.env.S3_SECRET_ACCESS_KEY = 'env-secret'
    resetEnv()
    rows = { 's3.bucket': 'bucket-from-panel', 'storage.driver': 's3' }
    const config = await storageResolverFor(reader())()
    expect(config.s3?.bucket).toBe('bucket-from-panel')
    // Unset fields still come from the environment, one key at a time.
    expect(config.s3?.accessKeyId).toBe('env-key')
  })

  it('changes its fingerprint when the stored settings change, and only then', async () => {
    const resolve = storageResolverFor(reader())
    rows = { 'storage.driver': 'fs', 'storage.public_cdn_url': 'https://cdn.one.example' }
    const first = await resolve()
    const again = await resolve()
    expect(again.fingerprint).toBe(first.fingerprint)
    rows = { 'storage.driver': 'fs', 'storage.public_cdn_url': 'https://cdn.two.example' }
    expect((await resolve()).fingerprint).not.toBe(first.fingerprint)
  })

  it('never puts the secret access key in the fingerprint', async () => {
    process.env.STORAGE_DRIVER = 's3'
    process.env.S3_BUCKET = 'b'
    process.env.S3_ENDPOINT = 'https://e.example'
    process.env.S3_ACCESS_KEY_ID = 'k'
    process.env.S3_SECRET_ACCESS_KEY = 'x'
    resetEnv()
    rows = { 'storage.driver': 's3', 's3.secret_access_key': 'super-secret-value' }
    const config = await storageResolverFor(reader())()
    expect(config.fingerprint).not.toContain('super-secret-value')
    // Length and last characters are enough to notice a rotation.
    expect(config.fingerprint).toContain('18:alue')
  })
})

describe('installWorkerConfig', () => {
  it('rebuilds the storage client when the stored settings change', async () => {
    installWorkerConfig(db, { ttlMs: 0, read: async () => ({ ...rows }) })
    rows = { 'storage.driver': 'fs', 'storage.public_cdn_url': 'https://cdn.one.example' }
    const first = await getStorage()
    expect(await getStorage()).toBe(first)
    rows = { 'storage.driver': 'fs', 'storage.public_cdn_url': 'https://cdn.two.example' }
    const second = await getStorage()
    expect(second).not.toBe(first)
    expect(second.getUrl('cover.avif')).toContain('cdn.two.example')
  })

  it('hands the same values to the modules shared with the web app', async () => {
    process.env.DISCORD_BOT_TOKEN = 'token-from-env'
    installWorkerConfig(db, { ttlMs: 0, read: async () => ({ ...rows }) })
    // Nothing stored: the environment still runs the bot, exactly as before.
    expect(await credentialValue('discord.bot_token', 'DISCORD_BOT_TOKEN')).toBe('token-from-env')
    rows = { 'discord.bot_token': 'token-from-panel' }
    expect(await credentialValue('discord.bot_token', 'DISCORD_BOT_TOKEN')).toBe('token-from-panel')
    expect(await storedCredentials()).toEqual({ 'discord.bot_token': 'token-from-panel' })
  })
})
