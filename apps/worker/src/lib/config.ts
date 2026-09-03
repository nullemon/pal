import { configureCredentials } from '@palscans/core'
import { getEnv } from '@palscans/core/env'
import { type CreateStorageOptions, configureStorage } from '@palscans/core/storage'
import { type Db, readSealedCredentials } from '@palscans/db'

/**
 * The worker's half of the operator's stored credentials (docs/19).
 *
 * `apps/web` resolves these through `lib/config/store.ts`, which is `server-only` and reads
 * via Next's tagged cache — neither of which exists here. This module is the equivalent: it
 * reads the same sealed `app_credentials` rows through the same
 * `readSealedCredentials()` helper in `@palscans/db`, behind a short TTL because there is no
 * cache tag to purge from the admin panel. That TTL is the whole difference in behaviour: a
 * key saved in the panel reaches the web app on its next request and the worker within
 * `CREDENTIAL_TTL_MS`.
 *
 * Two consumers hang off it:
 *
 * - **storage** (`configureStorage`) — the worker uploads and re-encodes every page image, so
 *   it must use the same bucket the panel points the web app at. The fingerprint mirrors
 *   `apps/web/lib/config/snapshot.ts`: the client is rebuilt only when the resolved settings
 *   actually change, and the secret enters the fingerprint by length and last characters so
 *   it never reaches a log line.
 * - **shared modules** (`configureCredentials`) — `lib/notifications/config.ts` and
 *   `lib/discord/client.ts` are imported from `apps/web` by the notification jobs and read
 *   their VAPID keys and bot token through `@palscans/core`'s credential slot.
 *
 * Everything degrades the same way it always did: a database that is down, a row that will
 * not open under a rotated sealing key, or no `app_credentials` table at all leaves the
 * environment in charge rather than taking the worker down.
 */

/** How long a read of `app_credentials` is reused. Short: the panel cannot purge us. */
export const CREDENTIAL_TTL_MS = 30_000

interface Cached {
  at: number
  values: Record<string, string>
}

export interface WorkerConfigOptions {
  ttlMs?: number
  /** Injectable for tests; production reads the sealed rows. */
  read?: (db: Db) => Promise<Record<string, string>>
  now?: () => number
}

/**
 * A TTL-cached reader over `app_credentials`. Concurrent callers share one query, and a
 * failure yields `{}` — the environment alone still runs the worker.
 */
export const createCredentialReader = (
  db: Db,
  opts: WorkerConfigOptions = {},
): (() => Promise<Record<string, string>>) => {
  const ttlMs = opts.ttlMs ?? CREDENTIAL_TTL_MS
  const read = opts.read ?? readSealedCredentials
  const now = opts.now ?? Date.now
  let cached: Cached | undefined
  let inflight: Promise<Record<string, string>> | undefined

  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.values
    inflight ??= read(db)
      .then((values) => {
        cached = { at: now(), values }
        return values
      })
      .catch(() => {
        // Keep serving the last good read rather than reverting to the environment mid-job.
        cached = { at: now(), values: cached?.values ?? {} }
        return cached.values
      })
      .finally(() => {
        inflight = undefined
      })
    return inflight
  }
}

const trimmed = (values: Record<string, string>, id: string): string | undefined => {
  const value = (values[id] ?? '').trim()
  return value || undefined
}

/**
 * Point `getStorage()` at the resolved configuration, exactly as the web app does. Returned
 * so a test can call it directly; the storage adapter rebuilds when the fingerprint changes.
 */
export const storageResolverFor =
  (credentials: () => Promise<Record<string, string>>) =>
  async (): Promise<CreateStorageOptions & { fingerprint: string }> => {
    const values = await credentials()
    const env = getEnv()
    const stored = values['storage.driver']
    const driver = stored === 'fs' ? 'fs' : stored === 's3' ? 's3' : env.STORAGE_DRIVER
    const publicUrl = trimmed(values, 'storage.public_cdn_url') ?? env.PUBLIC_CDN_URL
    const s3 = {
      bucket: trimmed(values, 's3.bucket') ?? env.S3_BUCKET,
      endpoint: trimmed(values, 's3.endpoint') ?? env.S3_ENDPOINT,
      region: trimmed(values, 's3.region') ?? env.S3_REGION,
      accessKeyId: trimmed(values, 's3.access_key_id') ?? env.S3_ACCESS_KEY_ID,
      secretAccessKey: trimmed(values, 's3.secret_access_key') ?? env.S3_SECRET_ACCESS_KEY,
      forcePathStyle:
        values['s3.force_path_style'] === 'true' || (env.S3_FORCE_PATH_STYLE ?? false),
      publicUrl,
    }
    const secret = s3.secretAccessKey ?? ''
    return {
      driver,
      s3,
      fs: { root: env.STORAGE_FS_ROOT, publicUrl },
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
  }

/**
 * Install both resolvers. Called once at startup, before anything asks for storage.
 * Returns the reader so a caller can share the same cache.
 */
export const installWorkerConfig = (
  db: Db,
  opts: WorkerConfigOptions = {},
): (() => Promise<Record<string, string>>) => {
  const credentials = createCredentialReader(db, opts)
  configureCredentials(credentials)
  configureStorage(storageResolverFor(credentials))
  return credentials
}
