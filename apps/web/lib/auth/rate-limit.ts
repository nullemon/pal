import { getRedis, type RedisLike } from './redis'

/**
 * Fixed-window limits (docs/07): login 5/min per IP and per account with exponential
 * backoff, register 3/hour/IP, forgot-password 3/hour/email. Redis when available, an
 * in-process map otherwise (or when Redis is down).
 */
export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSec: number
}

interface Store {
  incr(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs: number): Promise<void>
  del(key: string): Promise<void>
}

class MemoryStore implements Store {
  private readonly items = new Map<string, { value: string; expiresAt: number }>()
  private readonly now: () => number
  constructor(now: () => number = Date.now) {
    this.now = now
  }
  private live(key: string) {
    const item = this.items.get(key)
    if (!item) return undefined
    if (item.expiresAt <= this.now()) {
      this.items.delete(key)
      return undefined
    }
    return item
  }
  async incr(key: string, windowMs: number) {
    const t = this.now()
    const item = this.live(key)
    if (!item) {
      this.items.set(key, { value: '1', expiresAt: t + windowMs })
      if (this.items.size > 20_000) for (const k of this.items.keys()) this.live(k)
      return { count: 1, ttlMs: windowMs }
    }
    const count = Number(item.value) + 1
    item.value = String(count)
    return { count, ttlMs: item.expiresAt - t }
  }
  async get(key: string) {
    return this.live(key)?.value ?? null
  }
  async set(key: string, value: string, ttlMs: number) {
    this.items.set(key, { value, expiresAt: this.now() + ttlMs })
  }
  async del(key: string) {
    this.items.delete(key)
  }
}

class RedisStore implements Store {
  private readonly fallback = new MemoryStore()
  constructor(private readonly client: Promise<RedisLike | null>) {}
  private async redis() {
    return this.client
  }
  async incr(key: string, windowMs: number) {
    const r = await this.redis()
    if (!r) return this.fallback.incr(key, windowMs)
    try {
      const count = await r.incr(key)
      let ttlMs = await r.pttl(key)
      if (ttlMs < 0) {
        ttlMs = windowMs
        await r.pexpire(key, windowMs)
      }
      return { count, ttlMs }
    } catch {
      return this.fallback.incr(key, windowMs)
    }
  }
  async get(key: string) {
    const r = await this.redis()
    if (!r) return this.fallback.get(key)
    try {
      return await r.get(key)
    } catch {
      return this.fallback.get(key)
    }
  }
  async set(key: string, value: string, ttlMs: number) {
    const r = await this.redis()
    if (!r) return this.fallback.set(key, value, ttlMs)
    try {
      await r.set(key, value, 'PX', ttlMs)
    } catch {
      await this.fallback.set(key, value, ttlMs)
    }
  }
  async del(key: string) {
    const r = await this.redis()
    if (!r) return this.fallback.del(key)
    try {
      await r.del(key)
    } catch {
      await this.fallback.del(key)
    }
  }
}

export class RateLimiter {
  constructor(private readonly store: Store) {}

  /** Count one hit in a fixed window. */
  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const { count, ttlMs } = await this.store.incr(`rl:${key}`, windowSec * 1000)
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSec: Math.max(1, Math.ceil(ttlMs / 1000)),
    }
  }

  /**
   * Login-style limit: `limit` per `windowSec`, and once exceeded the block doubles with
   * every further overflow (1 min, 2, 4 … up to `maxBlockSec`). Successful logins call
   * `clear` so an honest user is not punished for one typo streak.
   */
  async hitWithBackoff(
    key: string,
    limit: number,
    windowSec: number,
    maxBlockSec = 3600,
  ): Promise<RateLimitResult> {
    const blockKey = `block:${key}`
    const blocked = await this.store.get(blockKey)
    if (blocked) {
      const until = Number(blocked.split(':')[0])
      const retryAfterSec = Math.max(1, Math.ceil((until - Date.now()) / 1000))
      if (retryAfterSec > 0) return { ok: false, remaining: 0, retryAfterSec }
    }
    const result = await this.hit(key, limit, windowSec)
    if (result.ok) return result
    const strikes = Number((await this.store.get(`strikes:${key}`)) ?? '0') + 1
    const blockSec = Math.min(maxBlockSec, windowSec * 2 ** (strikes - 1))
    await this.store.set(`strikes:${key}`, String(strikes), maxBlockSec * 4 * 1000)
    await this.store.set(blockKey, `${Date.now() + blockSec * 1000}`, blockSec * 1000)
    return { ok: false, remaining: 0, retryAfterSec: blockSec }
  }

  async clear(key: string): Promise<void> {
    await Promise.all([
      this.store.del(`rl:${key}`),
      this.store.del(`block:${key}`),
      this.store.del(`strikes:${key}`),
    ])
  }
}

let shared: RateLimiter | undefined

/** Process-wide limiter chosen by REDIS_URL. */
export const getRateLimiter = (): RateLimiter => {
  shared ??= new RateLimiter(process.env.REDIS_URL ? new RedisStore(getRedis()) : new MemoryStore())
  return shared
}

/** A limiter over an in-process store — for tests. */
export const createMemoryRateLimiter = (now?: () => number): RateLimiter =>
  new RateLimiter(new MemoryStore(now))

/** The client address from the proxy headers, or null when unknown. */
export const clientIp = (request: Request): string | null => {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip')
  return ip || null
}
