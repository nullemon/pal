/**
 * One lazily-connected ioredis client for the auth module (session cache, rate limits).
 * Resolves to null when REDIS_URL is unset or Redis is unreachable, so every caller has
 * an in-process fallback and a cache outage never becomes a 500.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode: 'PX', ms: number): Promise<unknown>
  del(...keys: string[]): Promise<unknown>
  incr(key: string): Promise<number>
  pttl(key: string): Promise<number>
  pexpire(key: string, ms: number): Promise<unknown>
}

let shared: Promise<RedisLike | null> | undefined

export const getRedis = (
  redisUrl: string | undefined = process.env.REDIS_URL,
): Promise<RedisLike | null> => {
  if (shared) return shared
  if (!redisUrl) {
    shared = Promise.resolve(null)
    return shared
  }
  shared = import('ioredis')
    .then(({ Redis }) => {
      const r = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 1500,
      })
      r.on('error', () => undefined)
      return r.connect().then(
        () => r as unknown as RedisLike,
        () => null,
      )
    })
    .catch(() => null)
  return shared
}

/** Tests: drop the shared client so the next call re-reads the environment. */
export const resetRedis = (): void => {
  shared = undefined
}
