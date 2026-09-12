import { getEnv } from '../env.js'
import { FsStorage, type FsStorageOptions } from './fs.js'
import type { RoutableProfile } from './profiles.js'
import { StorageRouter } from './router.js'
import type { S3StorageOptions } from './s3.js'
import type { Storage } from './types.js'

export * from './fs.js'
export * from './mirror.js'
export * from './profiles.js'
export { StorageRouter } from './router.js'
export type { S3StorageOptions } from './s3.js'
export * from './types.js'

export type StorageDriver = 'fs' | 's3'

/** One bucket's settings, in whichever driver's shape the deployment uses. */
export interface StorageProfileOptions {
  fs?: FsStorageOptions
  s3?: S3StorageOptions
}

export interface CreateStorageOptions {
  driver?: StorageDriver
  fs?: FsStorageOptions
  s3?: S3StorageOptions
  /**
   * The private vault: raw originals, sitemap files, the healthcheck probe. Leave it out and
   * the site runs in single-bucket mode, exactly as it did before the split.
   */
  vault?: StorageProfileOptions
  /**
   * The mirror every durable object is copied into. Leave it out and mirroring is off — the
   * Backup screen then reads "Not configured", which is the honest answer.
   */
  objectBackup?: StorageProfileOptions
  /** Called after each durable write so the app can enqueue the mirror job. */
  onWrite?: (profile: RoutableProfile, key: string) => void
}

/**
 * Chosen by STORAGE_DRIVER (default fs). The S3 driver (and the AWS SDK) is loaded lazily
 * so the fs path costs nothing in bundles that never touch S3.
 */
export const createStorage = async (opts: CreateStorageOptions = {}): Promise<Storage> => {
  const driver: StorageDriver = opts.driver ?? getEnv().STORAGE_DRIVER
  switch (driver) {
    case 's3': {
      const { S3Storage } = await import('./s3.js')
      return new S3Storage(opts.s3)
    }
    case 'fs':
      return new FsStorage(opts.fs)
    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${String(driver)}`)
  }
}

/**
 * How `getStorage()` finds its configuration. The app registers one of these at startup so
 * credentials entered in the admin panel take effect without a redeploy (docs/19).
 *
 * It is injected rather than imported because this package must not depend on the database:
 * the worker and the web app each supply their own reader. `fingerprint` changes whenever
 * the resolved settings change, which is the signal to rebuild the client — that is what
 * makes a new R2 key live on the next request instead of the next deploy.
 */
export type StorageConfigResolver = () => Promise<CreateStorageOptions & { fingerprint: string }>

let resolver: StorageConfigResolver | undefined
let shared: Promise<StorageRouter> | undefined
let builtFrom: string | undefined

export const configureStorage = (next: StorageConfigResolver | undefined): void => {
  resolver = next
  shared = undefined
  builtFrom = undefined
}

/**
 * Build the three buckets and the router over them (`./router.ts`).
 *
 * A profile that is not configured falls back: no vault means private keys go to the public
 * bucket, which is what every deployment did before this existed and what the `fs`
 * development driver still does.
 */
export const createStorageRouter = async (
  opts: CreateStorageOptions = {},
): Promise<StorageRouter> => {
  const driver: StorageDriver = opts.driver ?? getEnv().STORAGE_DRIVER
  const configured = (profile?: StorageProfileOptions): boolean =>
    driver === 's3' ? !!profile?.s3?.bucket : !!profile?.fs?.root
  // A bucket with no hostname: `getUrl` on one is a bug, not a fallback (see router.ts).
  const secondary = async (profile: StorageProfileOptions): Promise<Storage> =>
    createStorage({
      driver,
      fs: profile.fs,
      s3: { ...profile.s3, noPublicUrl: true },
    })

  const [publicBucket, vault, backup] = await Promise.all([
    createStorage({ driver, fs: opts.fs, s3: opts.s3 }),
    configured(opts.vault) ? secondary(opts.vault as StorageProfileOptions) : null,
    configured(opts.objectBackup) ? secondary(opts.objectBackup as StorageProfileOptions) : null,
  ])
  return new StorageRouter({ public: publicBucket, private: vault, backup }, opts.onWrite)
}

/**
 * The process-wide storage instance. Built from the environment when no resolver is
 * registered, and rebuilt whenever the resolver reports different settings.
 */
export const getStorage = async (): Promise<StorageRouter> => {
  if (!resolver) {
    shared ??= createStorageRouter()
    return shared
  }
  const config = await resolver()
  if (config.fingerprint !== builtFrom || !shared) {
    builtFrom = config.fingerprint
    shared = createStorageRouter(config)
  }
  return shared
}
