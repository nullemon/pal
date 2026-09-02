/**
 * Fixed-window rate limits keyed by user (docs/14 §2 step 2). Redis when REDIS_URL is set
 * — shared across web instances — with an in-process fallback that also kicks in if Redis
 * is unreachable, so a cache outage degrades to per-instance limits rather than 500s.
 */
export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSec: number
}

export interface RateLimiter {
  readonly kind: 'memory' | 'redis'
  hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult>
  /** The live count of a key without touching it (0 when absent or expired). */
  count(key: string): Promise<number>
}

export class MemoryRateLimiter implements RateLimiter {
  readonly kind = 'memory' as const
  private readonly buckets = new Map<string, { count: number; resetAt: number }>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const t = this.now()
    let b = this.buckets.get(key)
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + windowSec * 1000 }
      this.buckets.set(key, b)
      if (this.buckets.size > 10_000) this.sweep(t)
    }
    b.count++
    const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - t) / 1000))
    return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfterSec }
  }

  async count(key: string): Promise<number> {
    const b = this.buckets.get(key)
    return b && b.resetAt > this.now() ? b.count : 0
  }

  private sweep(t: number): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k)
  }
}

interface RedisPipeline {
  incr(key: string): RedisPipeline
  pttl(key: string): RedisPipeline
  exec(): Promise<Array<[Error | null, unknown]> | null>
}

interface RedisLike {
  multi(): RedisPipeline
  pexpire(key: string, ms: number): Promise<unknown>
  get(key: string): Promise<string | null>
}

export class RedisRateLimiter implements RateLimiter {
  readonly kind = 'redis' as const
  private readonly fallback = new MemoryRateLimiter()
  private readonly client: Promise<RedisLike | null>

  constructor(client: Promise<RedisLike | null>) {
    this.client = client
  }

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const redis = await this.client
    if (!redis) return this.fallback.hit(key, limit, windowSec)
    try {
      const results = await redis.multi().incr(key).pttl(key).exec()
      const count = Number(results?.[0]?.[1] ?? 0)
      let ttl = Number(results?.[1]?.[1] ?? -1)
      if (ttl < 0) {
        ttl = windowSec * 1000
        await redis.pexpire(key, ttl)
      }
      return {
        ok: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSec: Math.max(1, Math.ceil(ttl / 1000)),
      }
    } catch {
      return this.fallback.hit(key, limit, windowSec)
    }
  }

  async count(key: string): Promise<number> {
    const redis = await this.client
    if (!redis) return this.fallback.count(key)
    try {
      return Number((await redis.get(key)) ?? 0)
    } catch {
      return this.fallback.count(key)
    }
  }
}

let shared: RateLimiter | undefined

/** Process-wide limiter chosen by REDIS_URL. ioredis loads lazily so tests stay light. */
export const getRateLimiter = (
  redisUrl: string | undefined = process.env.REDIS_URL,
): RateLimiter => {
  if (shared) return shared
  if (!redisUrl) {
    shared = new MemoryRateLimiter()
    return shared
  }
  const client = import('ioredis')
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
  shared = new RedisRateLimiter(client)
  return shared
}
