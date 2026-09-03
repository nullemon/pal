import 'server-only'
import type { CreateStorageOptions } from '@palscans/core/storage'
import { configureStorage } from '@palscans/core/storage'
import { getEnv } from '../env'
import { type ConfigMirror, configMirror } from './mirror'
import { credentialUnreadable, resolveConfig } from './store'

/**
 * A synchronously-readable copy of the two settings that are needed outside async code
 * (docs/19).
 *
 * Almost every credential is consumed from an async path — storage, OAuth, Stripe, mail,
 * Discord, push — and those read the store directly. But the storage driver and the CDN
 * hostname are read while building image URLs inside plain synchronous functions
 * (`lib/seo/urls.ts`, `components/discovery/media.ts`), and making those async would ripple
 * through most of the render tree for no benefit.
 *
 * `./mirror` holds the value (dependency-free, so it is safe to import anywhere) and
 * `resolveConfig()` writes through to it, so any async path that reads configuration keeps it
 * current. This module seeds it at process start and re-reads it after an admin save.
 *
 * Across several processes the store's own 300s cache bounds how long another worker or web
 * instance can still be using the previous value; a save is immediate only in the process
 * that handled it.
 */

export type ConfigSnapshot = ConfigMirror

/** The current values. Never throws and never blocks. */
export const configSnapshot = (): ConfigSnapshot => configMirror()

/**
 * Re-read the mirrored values. `resolveConfig()` does the writing through; a failure here
 * leaves the last good values in place rather than reverting the site mid-request.
 */
export const refreshConfigSnapshot = async (): Promise<ConfigSnapshot> => {
  try {
    await resolveConfig()
  } catch {
    // keep the previous values
  }
  return configMirror()
}

/**
 * Point `getStorage()` at the resolved configuration. Called once per process; the resolver
 * itself runs per call, but the store behind it is cached and the client is only rebuilt
 * when the fingerprint changes.
 */
export const installStorageResolver = (): void => {
  configureStorage(async (): Promise<CreateStorageOptions & { fingerprint: string }> => {
    const { values } = await resolveConfig()
    const env = getEnv()
    // An unreadable `storage.driver` row must not quietly become the env default (`fs`):
    // that would send production uploads to the container's local disk, where they vanish on
    // the next restart. Keep S3 selected so an upload fails loudly with missing credentials
    // instead of appearing to succeed in the wrong place.
    if (await credentialUnreadable('storage.driver'))
      return {
        driver: 's3',
        s3: { bucket: undefined, endpoint: undefined },
        fingerprint: 'unreadable-driver',
      }
    const driver =
      values['storage.driver'] === 'fs'
        ? 'fs'
        : values['storage.driver'] === 's3'
          ? 's3'
          : env.STORAGE_DRIVER
    const s3 = {
      bucket: values['s3.bucket'] || undefined,
      endpoint: values['s3.endpoint'] || undefined,
      region: values['s3.region'] || undefined,
      accessKeyId: values['s3.access_key_id'] || undefined,
      secretAccessKey: values['s3.secret_access_key'] || undefined,
      forcePathStyle: values['s3.force_path_style'] === 'true',
      publicUrl: values['storage.public_cdn_url'] || undefined,
    }
    // The fingerprint covers only what changes the client; the secret is hashed in by
    // length and last characters rather than value so it never reaches a log line.
    const secret = s3.secretAccessKey ?? ''
    return {
      driver,
      s3,
      fs: { root: env.STORAGE_FS_ROOT, publicUrl: values['storage.public_cdn_url'] || undefined },
      fingerprint: [
        driver,
        s3.bucket,
        s3.endpoint,
        s3.region,
        s3.accessKeyId,
        `${secret.length}:${secret.slice(-4)}`,
        s3.forcePathStyle,
        s3.publicUrl,
      ].join('|'),
    }
  })
}
