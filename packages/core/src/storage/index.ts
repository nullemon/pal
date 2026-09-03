import { getEnv } from '../env.js'
import { FsStorage, type FsStorageOptions } from './fs.js'
import type { S3StorageOptions } from './s3.js'
import type { Storage } from './types.js'

export * from './fs.js'
export type { S3StorageOptions } from './s3.js'
export * from './types.js'

export type StorageDriver = 'fs' | 's3'

export interface CreateStorageOptions {
  driver?: StorageDriver
  fs?: FsStorageOptions
  s3?: S3StorageOptions
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
let shared: Promise<Storage> | undefined
let builtFrom: string | undefined

export const configureStorage = (next: StorageConfigResolver | undefined): void => {
  resolver = next
  shared = undefined
  builtFrom = undefined
}

/**
 * The process-wide storage instance. Built from the environment when no resolver is
 * registered, and rebuilt whenever the resolver reports different settings.
 */
export const getStorage = async (): Promise<Storage> => {
  if (!resolver) {
    shared ??= createStorage()
    return shared
  }
  const config = await resolver()
  if (config.fingerprint !== builtFrom || !shared) {
    builtFrom = config.fingerprint
    shared = createStorage(config)
  }
  return shared
}
