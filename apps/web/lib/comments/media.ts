import { getEnv } from '@/lib/env'

/**
 * Public URL for a storage object key. The fs driver is served at `/_storage/<key>` by the
 * dev route handler (relative, so it works on any port); S3/R2 keys resolve against the CDN.
 */
export const storageUrl = (key: string | null | undefined): string | null => {
  if (!key) return null
  const safe = key.split('/').map(encodeURIComponent).join('/')
  const env = getEnv()
  if (env.STORAGE_DRIVER === 'fs') return `/_storage/${safe}`
  return `${env.PUBLIC_CDN_URL.replace(/\/+$/, '')}/${safe}`
}
