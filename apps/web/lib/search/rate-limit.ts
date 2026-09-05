import { clientIp, ipKey } from '@/lib/auth'
import { getRateLimiter, type RateLimiter } from '@/lib/auth/rate-limit'
import { getSessionUser } from '@/lib/auth/session'

/**
 * A per-caller budget for `/api/search` (docs/07 "Rate limits").
 *
 * The endpoint had none, and it is the most expensive anonymous GET on the site.
 * `searchSeries` runs two queries, and the first of them — the alternative-title lookup over
 * `series_titles` — is written as `similarity(title, $q) >= threshold`. pg_trgm's GIN index
 * answers the `%` operator, not a comparison against `similarity()`, so that predicate is
 * evaluated row by row: a Parallel Seq Scan over every alias in the catalogue, measured at
 * 632 ms and ~5,000 buffers against a 500,000-row `series_titles`. The `s-maxage=60` on the
 * response is no defence, because the cache key is `q` and the caller picks a new one every
 * request.
 *
 * So this is the same shape as `suggestLimit` on the request board, and for the same reason:
 * a public, read-only endpoint a script can fire in a loop needs a ceiling even though it
 * writes nothing. The limiter is the one `/dmca`, login and the comment composer already
 * share — Redis-backed when `REDIS_URL` is set, so the budget is per fleet and not per
 * process, with an in-process fallback when it is not.
 */

/**
 * Searches per minute, per identity. The palette debounces, so a person typing steadily
 * spends a handful; half a search a second is the ceiling a loop runs into. Deliberately
 * below the request board's 60/min: that endpoint answers from one prefix query, this one
 * from a scan.
 */
export const SEARCH_PER_MINUTE = 30

const MINUTE = 60

/** Who is asking, reduced to the two things a bucket is keyed on. */
export interface SearchActor {
  userId: number | null
  /**
   * The address component of the key — `ipKey`, so the raw address never reaches Redis, and
   * null when there is no trusted address to read (`TRUSTED_PROXY=none`).
   */
  limitKey: string | null
}

export interface SearchLimitVerdict {
  ok: boolean
  retryAfterSec: number
}

const ALLOWED: SearchLimitVerdict = { ok: true, retryAfterSec: 0 }

/** The actor for one request: the session if there is one, the address if it is knowable. */
export const searchActor = async (request: Request): Promise<SearchActor> => {
  const user = await getSessionUser().catch(() => null)
  return { userId: user?.id ?? null, limitKey: ipKey(clientIp(request)) }
}

/**
 * Count one search against every bucket that applies.
 *
 * Per account *and* per address, so neither signing in nor signing out is a way round the
 * budget. With neither known there is no bucket to count in and the request is allowed: the
 * alternative is a single shared "unknown" bucket, and one client — or five real readers
 * behind one proxy — would then switch search off for everybody. That is the same trade
 * `suggestLimit` and `formRateLimited` make, spelled out there too.
 */
export const searchLimit = async (
  actor: SearchActor,
  limiter: RateLimiter = getRateLimiter(),
): Promise<SearchLimitVerdict> => {
  const keys = [
    actor.userId ? `search:u:${actor.userId}` : null,
    actor.limitKey ? `search:k:${actor.limitKey}` : null,
  ].filter((k): k is string => k !== null)
  if (keys.length === 0) return ALLOWED
  const results = await Promise.all(keys.map((k) => limiter.hit(k, SEARCH_PER_MINUTE, MINUTE)))
  const worst = results.find((r) => !r.ok)
  return worst ? { ok: false, retryAfterSec: worst.retryAfterSec } : ALLOWED
}
