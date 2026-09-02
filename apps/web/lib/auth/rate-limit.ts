import { createHmac } from 'node:crypto'
import { getEnv } from '../env'
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
   * every further overflow (1 min, 2, 4 … up to `maxBlockSec`). docs/07 asks for backoff,
   * not a reset: a correct password never clears the window, so owning one account cannot
   * launder an IP's guesses against the others.
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

export interface TrustedProxy {
  mode: 'none' | 'xff' | 'cloudflare'
  hops: number
}

const proxyFromEnv = (): TrustedProxy => {
  const env = getEnv()
  return { mode: env.TRUSTED_PROXY, hops: env.TRUSTED_PROXY_HOPS }
}

/**
 * The client address as seen by the trusted proxy — the only helper that reads the
 * forwarding headers (rate-limit keys, session / comment / audit `ip_hash`). Proxies append
 * the address they saw to `X-Forwarded-For`, so the client-supplied hops come first and the
 * trustworthy one is the last (or `hops` from the end behind more than one trusted proxy);
 * the first hop is whatever the client typed. With no proxy configured the headers are not
 * consulted at all and the address is unknown (route handlers never see the socket).
 */
export const clientIp = (
  request: Request | Headers,
  proxy: TrustedProxy = proxyFromEnv(),
): string | null => {
  const headers = request instanceof Headers ? request : request.headers
  if (proxy.mode === 'none') return null
  if (proxy.mode === 'cloudflare') {
    const cf = headers.get('cf-connecting-ip')?.trim()
    if (cf) return cf
  }
  const hops =
    headers
      .get('x-forwarded-for')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  const fromChain = hops.at(-Math.max(1, proxy.hops))
  if (fromChain) return fromChain
  const real = headers.get('x-real-ip')?.trim()
  return real || null
}

/**
 * The same for an account identifier (login / forgot-password buckets): an e-mail address is
 * PII and a bare sha256 of it is a dictionary lookup for anyone holding Redis, so it is keyed
 * by the app secret and rotated daily exactly like `ipKey`.
 */
export const accountKey = (
  email: string,
  now: Date = new Date(),
  secret: string = getEnv().SESSION_SECRET,
): string =>
  createHmac('sha256', secret)
    .update(`${now.toISOString().slice(0, 10)}:${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)

/**
 * A rate-limit key component for an address: the raw IP never reaches Redis. HMAC with the
 * app secret over the UTC day, so a stored key is only ever linkable within that day.
 * Null when the address is unknown (`TRUSTED_PROXY=none`): callers then skip the per-IP
 * bucket rather than pooling every client into one — a shared "unknown" bucket would let
 * one attacker (or five real users) lock login for the whole site.
 */
export const ipKey = (
  ip: string | null,
  now: Date = new Date(),
  secret: string = getEnv().SESSION_SECRET,
): string | null =>
  ip
    ? createHmac('sha256', secret)
        .update(`${now.toISOString().slice(0, 10)}:${ip}`)
        .digest('hex')
        .slice(0, 32)
    : null
