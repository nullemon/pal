import { createHmac } from 'node:crypto'

/**
 * View tracking (docs/02 "Views and ranking"). Everything here is pure or self-contained so
 * it can be tested without a database: the viewer key, the honesty rules (bot filter,
 * per-day dedupe), the write buffer that keeps page renders off the hot path, and the
 * partition arithmetic the worker runs against `view_events`.
 *
 * The shape of the pipeline:
 *
 *   browser beacon → POST /api/views → bot + dedupe check → ViewBuffer (in memory)
 *     → one batched INSERT into view_events every ~2 s
 *     → worker `stats.rollup` every ~2 min → series_stats_daily / chapter_stats_daily
 *       → deltas added to series.view_count / chapters.view_count
 *
 * No page render ever writes; the only synchronous cost of a view is a Redis SET NX.
 */

/** `chapter_id` for a series-page view — the column is NOT NULL with a 0 default. */
export const SERIES_PAGE_CHAPTER_ID = 0

/** Bytes of HMAC kept as the viewer key. 16 is plenty against collisions and half the size. */
export const VIEWER_KEY_BYTES = 16

export interface ViewerKeyInput {
  /** The day the view belongs to (`YYYY-MM-DD`, UTC) — rotates the key daily. */
  bucket: string
  /** Signed-in reader, if any. Takes precedence over the address. */
  userId?: number | null
  /** Client address, already resolved through the trusted-proxy rules. */
  ip?: string | null
  userAgent?: string | null
}

/**
 * `viewer_key` = HMAC(secret, day | identity) truncated to 16 bytes (docs/02:
 * "hash(user_id | ip+ua salt) for dedupe"). The day is inside the HMAC, so a key is only
 * ever linkable within one UTC day and the raw address never reaches the database.
 *
 * A signed-in reader is keyed by account, so the same person on phone and laptop counts
 * once. Everyone else is keyed by address + user agent.
 */
export const viewerKey = (input: ViewerKeyInput, secret: string): Uint8Array => {
  const identity =
    input.userId != null && input.userId > 0
      ? `u:${input.userId}`
      : `a:${input.ip ?? 'unknown'}|${(input.userAgent ?? '').slice(0, 200)}`
  const digest = createHmac('sha256', secret).update(`${input.bucket}|${identity}`).digest()
  return new Uint8Array(digest.subarray(0, VIEWER_KEY_BYTES))
}

/** Lowercase hex of a viewer key — the Redis dedupe key and the test-friendly form. */
export const viewerKeyHex = (key: Uint8Array): string =>
  Array.from(key, (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * The dedupe identity of a view: one viewer, one chapter (or series page), one UTC day.
 * Exactly the primary key of `view_events`, so Redis and Postgres agree on what a
 * duplicate is — a reader who refreshes ten times is one view either way.
 */
export const viewDedupeKey = (hit: ViewHit): string =>
  `pv:${hit.bucket}:${hit.seriesId}:${hit.chapterId}:${viewerKeyHex(hit.viewerKey)}`

/** Seconds left in the UTC day — the TTL that makes the Redis pre-check expire with the bucket. */
export const secondsUntilNextBucket = (now: Date = new Date()): number => {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

/**
 * Crawlers, previewers and scripted clients. Anything matching is never counted.
 *
 * This is the second of three filters, not the only one: the view is reported by a script
 * that has to run for 1.5 s in a visible tab (most crawlers never get there), and the
 * `view_events` primary key caps whatever survives at one row per viewer per chapter per
 * day. The list is deliberately broad — a missed human view costs nothing, an inflated
 * ranking costs the operator's trust in the number.
 */
const BOT_UA =
  /bot\b|bots?\/|crawl|spider|slurp|scrape|fetcher|archiver|monitor|preview|headless|phantomjs|puppeteer|playwright|selenium|curl\/|wget|python-requests|python-urllib|httpx|aiohttp|axios\/|node-fetch|go-http-client|java\/|okhttp|libwww|lwp::|guzzle|postman|insomnia|feedly|facebookexternalhit|whatsapp|telegram|discord|slackbot|embedly|quora link|skypeuripreview|vkshare|pinterest|redditbot|yandex|baidu|sogou|petal|semrush|ahrefs|mj12|dotbot|dataforseo|barkrowler|serpstat|seokicks|gptbot|claude|anthropic|ccbot|perplexity|bytespider|amazonbot|applebot|duckduck|google-?(?:other|extended|inspectiontool)|adsbot/i

export const isBotUserAgent = (ua: string | null | undefined): boolean => {
  if (!ua) return true // no user agent at all is never a browser tab running our beacon
  return BOT_UA.test(ua)
}

// --- the write buffer -------------------------------------------------------------------

export interface ViewHit {
  seriesId: number
  /** 0 for a series-page view (`SERIES_PAGE_CHAPTER_ID`). */
  chapterId: number
  /** `YYYY-MM-DD`, UTC. */
  bucket: string
  viewerKey: Uint8Array
}

export interface ViewBufferOptions {
  /** Write a batch. Rejecting puts the rows back for one more attempt. */
  flush: (rows: ViewHit[]) => Promise<void>
  /** Flush as soon as this many distinct hits are queued. */
  maxRows?: number
  /** Flush this long after the first hit of a batch arrived. */
  maxAgeMs?: number
  /** Hard ceiling; hits past it are dropped rather than growing without bound. */
  maxQueued?: number
  onError?: (error: unknown, rows: readonly ViewHit[]) => void
}

export interface ViewBufferStats {
  queued: number
  /** Hits accepted into the buffer (after in-buffer dedupe). */
  accepted: number
  /** Hits collapsed because an identical one was already queued. */
  collapsed: number
  /** Rows handed to `flush` successfully. */
  written: number
  /** Hits thrown away because the buffer was full, or a batch failed twice. */
  dropped: number
  batches: number
  failures: number
}

const DEFAULTS = { maxRows: 200, maxAgeMs: 2_000, maxQueued: 20_000 }

/**
 * Batches view hits so a page view costs no database round trip of its own.
 *
 * The trade-off, stated plainly: hits live in the process for at most `maxAgeMs` (2 s by
 * default), so a hard kill loses that window. Views are statistics, not money — losing two
 * seconds of them on a deploy is cheaper than an `INSERT` per reader. Everything that must
 * survive (progress, bookmarks, ratings) already writes synchronously elsewhere.
 */
export class ViewBuffer {
  private readonly opts: Required<Omit<ViewBufferOptions, 'onError'>> &
    Pick<ViewBufferOptions, 'onError'>
  private rows = new Map<string, ViewHit>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private inflight: Promise<void> | null = null
  private retried = new Set<string>()
  private readonly counters = {
    accepted: 0,
    collapsed: 0,
    written: 0,
    dropped: 0,
    batches: 0,
    failures: 0,
  }

  constructor(options: ViewBufferOptions) {
    this.opts = { ...DEFAULTS, ...options }
  }

  get size(): number {
    return this.rows.size
  }

  stats(): ViewBufferStats {
    return { queued: this.rows.size, ...this.counters }
  }

  /** Queue one hit. Returns false when it was a duplicate of a queued hit, or dropped. */
  add(hit: ViewHit): boolean {
    const key = viewDedupeKey(hit)
    if (this.rows.has(key)) {
      this.counters.collapsed++
      return false
    }
    if (this.rows.size >= this.opts.maxQueued) {
      this.counters.dropped++
      return false
    }
    this.rows.set(key, hit)
    this.counters.accepted++
    if (this.rows.size >= this.opts.maxRows) void this.flush()
    else this.arm()
    return true
  }

  private arm(): void {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.opts.maxAgeMs)
    // never hold a process open for a pending stats write
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  /** Write everything queued. Concurrent calls join the in-flight batch. */
  async flush(): Promise<void> {
    if (this.inflight) return this.inflight
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.rows.size === 0) return
    const batch = [...this.rows.entries()]
    this.rows = new Map()
    const run = async () => {
      try {
        await this.opts.flush(batch.map(([, hit]) => hit))
        this.counters.written += batch.length
        for (const [key] of batch) this.retried.delete(key)
      } catch (error) {
        this.counters.failures++
        this.opts.onError?.(
          error,
          batch.map(([, hit]) => hit),
        )
        // one retry per hit: a transient blip keeps the batch, a broken database does not
        // turn the buffer into an ever-growing queue.
        for (const [key, hit] of batch) {
          if (this.retried.has(key)) {
            this.retried.delete(key)
            this.counters.dropped++
            continue
          }
          if (this.rows.size >= this.opts.maxQueued || this.rows.has(key)) {
            this.counters.dropped++
            continue
          }
          this.retried.add(key)
          this.rows.set(key, hit)
        }
      } finally {
        this.counters.batches++
        this.inflight = null
      }
      // A burst that arrived while this batch was in flight goes out at once rather than
      // waiting for the timer; anything smaller waits for the window to fill.
      if (this.rows.size >= this.opts.maxRows) void this.flush()
      else if (this.rows.size > 0) this.arm()
    }
    this.inflight = run()
    return this.inflight
  }

  /** Stop the timer and write what is left (process shutdown, tests). */
  async close(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.flush()
    await this.inflight
  }
}

// --- partitions -------------------------------------------------------------------------

/** How many days of `view_events` are kept (docs/02: "drops partitions older than 90 days"). */
export const VIEW_RETENTION_DAYS = 90
/** Partitions are created this many days ahead of today, so tomorrow always exists. */
export const VIEW_PARTITION_AHEAD_DAYS = 2

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

/** `2026-09-04` → `view_events_20260904` — the name the worker creates and drops. */
export const viewPartitionName = (bucket: string | Date): string => {
  const d = typeof bucket === 'string' ? new Date(`${bucket}T00:00:00Z`) : bucket
  return `view_events_${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

/** The day a partition name covers, or null when the name is not a daily partition. */
export const viewPartitionBucket = (name: string): string | null => {
  const m = /^view_events_(\d{4})(\d{2})(\d{2})$/.exec(name)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** The `YYYY-MM-DD` bucket `days` before (negative: after) `now`, UTC. */
export const shiftBucket = (bucket: string, days: number): string => {
  const t = Date.parse(`${bucket}T00:00:00Z`) + days * DAY_MS
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * Which existing partitions the retention pass should drop: dated partitions strictly
 * older than the cutoff. `view_events_default` is never in the result — it is the landing
 * zone for days nothing created a partition for and dropping it would lose those rows.
 */
export const partitionsToDrop = (names: readonly string[], cutoff: string): string[] =>
  names.filter((n) => {
    const bucket = viewPartitionBucket(n)
    return bucket !== null && bucket < cutoff
  })

/**
 * The window `stats.rollup` recomputes. Today plus a short tail, so the UTC-midnight
 * rollover and a worker that missed a few passes both come out right; a wider window is a
 * backfill and is asked for explicitly on the job.
 */
export const rollupWindow = (
  now: Date = new Date(),
  lookbackDays = 1,
): { from: string; to: string } => {
  const to = now.toISOString().slice(0, 10)
  return { from: shiftBucket(to, -Math.max(0, lookbackDays)), to }
}
