import {
  isBotUserAgent,
  SERIES_PAGE_CHAPTER_ID,
  secondsUntilNextBucket,
  ViewBuffer,
  type ViewHit,
  viewDedupeKey,
  viewerKey,
} from '@palscans/core'
import { ensureViewPartitions, getDb, recordViewEvents } from '@palscans/db'
import { clientIp, ipKey } from '@/lib/auth/rate-limit'
import { getRedis, type RedisLike } from '@/lib/auth/redis'
import { getEnv } from '@/lib/env'

/**
 * Recording a view (docs/02 "Views and ranking"). Nothing here runs during a page render:
 * the browser reports the view with `sendBeacon` after it has been on the page for a moment,
 * and this module decides whether it counts and gets it to Postgres cheaply.
 *
 * Per accepted view the synchronous cost is one Redis `SET NX PX` — no database round trip.
 * Hits go into an in-process buffer and reach `view_events` as one multi-row INSERT every
 * two seconds (or every 200 hits, whichever comes first). At 500 views/second that is ~2.5
 * statements per second instead of 500.
 *
 * Honesty is enforced three times over, cheapest first:
 *   1. a bot user agent, or none, is never counted;
 *   2. a per-address budget stops a script from manufacturing views faster than a person
 *      could open pages;
 *   3. the same viewer × chapter × UTC day is one view — in Redis first (so it costs
 *      nothing), and again in the `view_events` primary key, which is what actually
 *      guarantees it across app instances and across a Redis outage.
 */

/** Flush when this many distinct hits are queued. */
const MAX_ROWS = 200
/** …or this long after the first hit of a batch. The window a hard kill can lose. */
const MAX_AGE_MS = 2_000
/** Refuse to grow past this; a database outage drops views rather than the process. */
const MAX_QUEUED = 20_000

/**
 * Views one address may register per minute. A reader opening a chapter every two seconds
 * for a minute is well inside it; a script is not. Signed-in readers are keyed by account.
 */
export const VIEW_RATE_LIMIT = 40
export const VIEW_RATE_WINDOW_SEC = 60

export interface ViewRequest {
  seriesId: number
  chapterId?: number
  userId?: number | null
  ip?: string | null
  userAgent?: string | null
  now?: Date
}

export type ViewOutcome = 'recorded' | 'bot' | 'duplicate' | 'rate_limited' | 'buffered_full'

export interface ViewRecorderOptions {
  /** Write a batch of hits (defaults to `view_events` through `@palscans/db`). */
  write?: (rows: ViewHit[]) => Promise<void>
  /** Cross-instance dedupe + budget store. `null` forces the in-process fallback. */
  redis?: () => Promise<RedisLike | null>
  secret?: string
  maxAgeMs?: number
  maxRows?: number
}

/** In-process fallback for the dedupe / budget store when Redis is unset or unreachable. */
class LocalStore {
  private readonly items = new Map<string, number>()
  private readonly counts = new Map<string, { n: number; expiresAt: number }>()

  /** True when the key was free (and is now taken until `ttlMs`). */
  claim(key: string, ttlMs: number, now: number): boolean {
    const until = this.items.get(key)
    if (until !== undefined && until > now) return false
    this.items.set(key, now + ttlMs)
    if (this.items.size > 100_000) this.sweep(now)
    return true
  }

  hit(key: string, windowMs: number, now: number): number {
    const b = this.counts.get(key)
    if (!b || b.expiresAt <= now) {
      this.counts.set(key, { n: 1, expiresAt: now + windowMs })
      return 1
    }
    b.n++
    return b.n
  }

  private sweep(now: number): void {
    for (const [k, until] of this.items) if (until <= now) this.items.delete(k)
    for (const [k, b] of this.counts) if (b.expiresAt <= now) this.counts.delete(k)
    if (this.items.size > 100_000) this.items.clear()
  }
}

/**
 * The recorder. One per process in the app (`viewRecorder()`); tests build their own with
 * an injected writer so nothing touches Redis or Postgres.
 */
export class ViewRecorder {
  private readonly buffer: ViewBuffer
  private readonly local = new LocalStore()
  private readonly redis: () => Promise<RedisLike | null>
  private readonly secret: string

  constructor(opts: ViewRecorderOptions = {}) {
    const write = opts.write ?? defaultWrite
    this.redis = opts.redis ?? (() => getRedis())
    this.secret = opts.secret ?? getEnv().SESSION_SECRET
    this.buffer = new ViewBuffer({
      flush: write,
      maxRows: opts.maxRows ?? MAX_ROWS,
      maxAgeMs: opts.maxAgeMs ?? MAX_AGE_MS,
      maxQueued: MAX_QUEUED,
      onError: (error) => {
        console.error('[views] batch write failed', error)
      },
    })
  }

  stats() {
    return this.buffer.stats()
  }

  /** Write whatever is queued (tests, shutdown). */
  flush(): Promise<void> {
    return this.buffer.flush()
  }

  async record(input: ViewRequest): Promise<ViewOutcome> {
    const now = input.now ?? new Date()
    if (isBotUserAgent(input.userAgent)) return 'bot'

    const bucket = now.toISOString().slice(0, 10)
    const hit: ViewHit = {
      seriesId: input.seriesId,
      chapterId: input.chapterId ?? SERIES_PAGE_CHAPTER_ID,
      bucket,
      viewerKey: viewerKey(
        { bucket, userId: input.userId, ip: input.ip, userAgent: input.userAgent },
        this.secret,
      ),
    }
    const redis = await this.redis().catch(() => null)
    const t = now.getTime()

    // 2. budget, per viewer identity rather than per raw address, so the key rotates daily
    const budgetKey = `pv:rate:${input.userId ?? ''}:${ipKey(input.ip ?? null, now, this.secret) ?? 'anon'}`
    const used = redis
      ? await this.incr(redis, budgetKey, VIEW_RATE_WINDOW_SEC * 1000)
      : this.local.hit(budgetKey, VIEW_RATE_WINDOW_SEC * 1000, t)
    if (used > VIEW_RATE_LIMIT) return 'rate_limited'

    // 3. dedupe, with the same TTL as the bucket the primary key enforces
    const dedupe = viewDedupeKey(hit)
    const ttlMs = secondsUntilNextBucket(now) * 1000
    const fresh = redis
      ? await this.claim(redis, dedupe, ttlMs)
      : this.local.claim(dedupe, ttlMs, t)
    if (!fresh) return 'duplicate'

    return this.buffer.add(hit) ? 'recorded' : 'duplicate'
  }

  private async claim(redis: RedisLike, key: string, ttlMs: number): Promise<boolean> {
    try {
      const setnx = redis as unknown as {
        set(k: string, v: string, mode: 'PX', ms: number, nx: 'NX'): Promise<string | null>
      }
      return (await setnx.set(key, '1', 'PX', Math.max(1000, ttlMs), 'NX')) !== null
    } catch {
      // Redis blipped: fall back to the local claim. Postgres still refuses the duplicate.
      return this.local.claim(key, ttlMs, Date.now())
    }
  }

  private async incr(redis: RedisLike, key: string, windowMs: number): Promise<number> {
    try {
      const n = await redis.incr(key)
      if (n === 1) await redis.pexpire(key, windowMs)
      return n
    } catch {
      return this.local.hit(key, windowMs, Date.now())
    }
  }
}

let ensuredBucket: string | null = null

/**
 * Once per process per day, make sure `view_events` has today's and tomorrow's partition.
 * The worker does this too; doing it here as well means a deployment running only the web
 * app still writes into dated partitions instead of piling everything into the default one.
 */
export const ensureBucketPartitions = async (bucket: string): Promise<void> => {
  if (ensuredBucket === bucket) return
  ensuredBucket = bucket
  try {
    await ensureViewPartitions(await getDb(), { from: bucket })
  } catch (error) {
    ensuredBucket = null
    console.error('[views] could not ensure partitions', error)
  }
}

const defaultWrite = async (rows: ViewHit[]): Promise<void> => {
  const bucket = rows[0]?.bucket
  if (bucket) await ensureBucketPartitions(bucket)
  await recordViewEvents(await getDb(), rows)
}

let shared: ViewRecorder | undefined

/** The process-wide recorder used by POST /api/views. */
export const recorder = (): ViewRecorder => {
  shared ??= new ViewRecorder()
  return shared
}

/** Resolve the viewer identity of a request the way the rate limiter does. */
export const viewerFor = (request: Request, userId: number | null) => ({
  userId,
  ip: clientIp(request),
  userAgent: request.headers.get('user-agent'),
})
