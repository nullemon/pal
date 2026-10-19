import 'server-only'
import { classifyTraffic, isCountableSource, normaliseCampaign } from '@palscans/core/traffic'
import { getDb, recordTrafficHits } from '@palscans/db'
import { getEnv } from '@/lib/env'

/**
 * Counting where visits come from (docs/13).
 *
 * Buffered in process and flushed as one upsert, for the same reason views are: this runs
 * on a two-core box and a write per visit to a handful of hot rows is contention bought for
 * nothing. A day's traffic is at most a few dozen rows, so a flush is tiny however busy the
 * site is.
 *
 * What is *not* here is as deliberate as what is. No visitor key, no address, no path, no
 * timestamp finer than the day. The buffer holds counts and the table holds counts, so
 * there is nothing to reconstruct a person's browsing from even with the database open.
 */

const FLUSH_MS = 10_000
const MAX_KEYS = 500

interface Buffered {
  bucket: string
  source: string
  campaign: string
  hits: number
}

const counts = new Map<string, Buffered>()
let timer: ReturnType<typeof setTimeout> | null = null

const bucketOf = (now: Date): string => now.toISOString().slice(0, 10)

export const flushTraffic = async (
  write: (rows: Buffered[]) => Promise<unknown> = async (rows) =>
    recordTrafficHits(await getDb(), rows),
): Promise<number> => {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (counts.size === 0) return 0
  const rows = [...counts.values()]
  counts.clear()
  try {
    await write(rows)
  } catch {
    // A failed flush loses counts rather than retrying them. These are rounded numbers on
    // an admin panel: a lost minute is invisible, while a growing retry queue on a 2 GB box
    // is not, and nothing downstream reads this as truth.
  }
  return rows.length
}

const schedule = () => {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void flushTraffic()
  }, FLUSH_MS)
  // Never hold the process open for a counter.
  timer.unref?.()
}

/**
 * Count one visit, given what the browser reported.
 *
 * A referral from this site is dropped: a reader moving from chapter 1 to chapter 2 is not
 * a new visit from anywhere, and counting those would bury every real source under the site
 * itself — the failure where the report looks fine and says nothing.
 */
export const countTraffic = (
  referrer: string | null | undefined,
  ref: string | null | undefined,
  now: Date = new Date(),
): void => {
  const host = (() => {
    try {
      return new URL(getEnv().SITE_URL).hostname
    } catch {
      return 'palscans.org'
    }
  })()
  const hit = classifyTraffic(referrer, ref, host)
  if (!isCountableSource(hit.source)) return
  const bucket = bucketOf(now)
  const key = `${bucket}|${hit.source}|${hit.campaign}`
  const existing = counts.get(key)
  if (existing) {
    existing.hits += 1
    schedule()
    return
  }
  // A cap, because `campaign` is attacker-supplied: a script trying a new `?ref=` every
  // request would otherwise grow this map without limit. Past the cap the tag is dropped
  // and the visit still counts under its source, which is the part worth keeping.
  if (counts.size >= MAX_KEYS) {
    const plain = `${bucket}|${hit.source}|`
    const row = counts.get(plain)
    if (row) row.hits += 1
    else counts.set(plain, { bucket, source: hit.source, campaign: '', hits: 1 })
    schedule()
    return
  }
  counts.set(key, { bucket, source: hit.source, campaign: hit.campaign, hits: 1 })
  schedule()
}

/** The `?ref=` tag, normalised the same way the counter does it. */
export { normaliseCampaign }

/**
 * What to store on a new account: the source it came from, bucketed.
 *
 * One attribute written once, which is the whole of it — it answers "are these sign-ups
 * from the X link?" and then never changes. The raw referrer does not reach the database:
 * it can carry the search query that led here, and the useful fact is "Google", not the
 * words somebody typed.
 */
export const signupAttribution = (
  referrer: string | null | undefined,
  ref: string | null | undefined,
): { signupSource: string | null; signupCampaign: string | null } => {
  const host = (() => {
    try {
      return new URL(getEnv().SITE_URL).hostname
    } catch {
      return 'palscans.org'
    }
  })()
  const hit = classifyTraffic(referrer, ref, host)
  // A visit that arrived from another page of the site still has a source: whatever brought
  // them to the site is lost by then, so `internal` is recorded as unknown rather than as a
  // referral from ourselves.
  return {
    signupSource: hit.source === 'internal' ? null : hit.source,
    signupCampaign: hit.campaign || null,
  }
}
