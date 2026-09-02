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

let shared: Promise<Storage> | undefined
/** Process-wide storage instance built from the environment on first use. */
export const getStorage = (): Promise<Storage> => {
  shared ??= createStorage()
  return shared
}
