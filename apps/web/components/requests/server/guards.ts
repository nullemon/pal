import { getRateLimiter, type RateLimiter } from '@/lib/auth/rate-limit'
import type { RequestActor } from './identity'

/**
 * What stands between `/api/requests` and the open internet.
 *
 * This is the most abusable surface on the site — a write endpoint that takes free text and
 * needs no account — so it reuses the two gates the other public forms already use rather
 * than inventing a third: the fixed-window limiter from `lib/auth/rate-limit` (the one
 * `/dmca` and the comment composer share, Redis-backed when `REDIS_URL` is set) and
 * Cloudflare Turnstile through `lib/auth/turnstile`. Nothing here is new machinery.
 *
 * The order is the cheap check first: honeypot (in the schema), then the limiter (one Redis
 * INCR), then Turnstile (a network round trip, and only for a request that would otherwise
 * be accepted).
 */

/** New requests per hour, per identity. A person files one; a script wants hundreds. */
export const SUBMIT_PER_HOUR = 3
/** …and per day, so three an hour cannot become seventy-two. */
export const SUBMIT_PER_DAY = 10
/** Votes per hour. Enough to work down a long board in one sitting, not enough to script. */
export const VOTE_PER_HOUR = 60
/** Suggest queries per minute — it runs on every keystroke, debounced, and hits Postgres. */
export const SUGGEST_PER_MINUTE = 60

const HOUR = 3600
const DAY = 86_400
const MINUTE = 60

export interface LimitVerdict {
  ok: boolean
  retryAfterSec: number
}

const OK: LimitVerdict = { ok: true, retryAfterSec: 0 }

/**
 * Count one hit against every bucket that applies. A signed-in reader is limited per account
 * *and* per address, so neither "make an account" nor "change address" is a way round it;
 * with neither known (no trusted proxy, no cookie yet) there is no bucket to count in and
 * the caller is left to the other gates — the same choice `formRateLimited` makes, and for
 * the same reason: a shared "unknown" bucket lets one client lock the feature for everybody.
 */
const limit = async (
  actor: RequestActor,
  name: string,
  max: number,
  windowSec: number,
  limiter: RateLimiter = getRateLimiter(),
): Promise<LimitVerdict> => {
  const keys = [
    actor.userId ? `req:${name}:u:${actor.userId}` : null,
    actor.limitKey ? `req:${name}:k:${actor.limitKey}` : null,
  ].filter((k): k is string => k !== null)
  if (keys.length === 0) return OK
  const results = await Promise.all(keys.map((k) => limiter.hit(k, max, windowSec)))
  const worst = results.find((r) => !r.ok)
  return worst ? { ok: false, retryAfterSec: worst.retryAfterSec } : OK
}

/**
 * Two windows, because one is not enough: the hourly cap stops a burst, and the daily cap
 * stops somebody patiently spending it every hour for a day. `limiter` is injectable so the
 * tests can drive a clock rather than wait an hour.
 */
export const submitLimit = async (
  actor: RequestActor,
  limiter?: RateLimiter,
): Promise<LimitVerdict> => {
  const hourly = await limit(actor, 'submit:h', SUBMIT_PER_HOUR, HOUR, limiter)
  if (!hourly.ok) return hourly
  return limit(actor, 'submit:d', SUBMIT_PER_DAY, DAY, limiter)
}

export const voteLimit = (actor: RequestActor, limiter?: RateLimiter): Promise<LimitVerdict> =>
  limit(actor, 'vote', VOTE_PER_HOUR, HOUR, limiter)

export const suggestLimit = (actor: RequestActor, limiter?: RateLimiter): Promise<LimitVerdict> =>
  limit(actor, 'suggest', SUGGEST_PER_MINUTE, MINUTE, limiter)
