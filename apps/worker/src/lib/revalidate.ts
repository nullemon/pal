import { log } from './log.js'

/**
 * Ask the web app to drop its cached catalog after the worker publishes something. The
 * worker runs in its own process, so `revalidateTag` is out of reach; the web app exposes
 * POST /api/internal/revalidate behind the shared `INTERNAL_API_SECRET` (default:
 * `SESSION_SECRET`). Best effort: a failure is logged, never thrown — the cache expires on
 * its own within the page's revalidate window.
 *
 * `INTERNAL_URL` is preferred over `SITE_URL` and should be the address of the web container
 * on the internal network (`http://web:3000`). Going out via `SITE_URL` means every publish
 * leaves for the CDN edge and comes back in: it needs working hairpin NAT, it is subject to
 * whatever WAF rules sit in front of the site, and when it fails the only symptom is a stale
 * catalogue and one warning line.
 */
export const revalidateWeb = async (
  tags: Array<'catalog' | 'settings' | 'appearance'>,
): Promise<boolean> => {
  const base = process.env.INTERNAL_URL || process.env.SITE_URL
  const secret = process.env.INTERNAL_API_SECRET ?? process.env.SESSION_SECRET
  if (!base || !secret) {
    log.warn(
      'revalidate skipped: no INTERNAL_URL/SITE_URL, or no INTERNAL_API_SECRET/SESSION_SECRET',
      {
        tags,
      },
    )
    return false
  }
  try {
    const res = await fetch(new URL('/api/internal/revalidate', base), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      log.warn('revalidate failed', { status: res.status, tags })
      return false
    }
    return true
  } catch (err) {
    log.error('revalidate failed', err)
    return false
  }
}

/** How often the worker asks the web app to run its periodic jobs. */
const MAINTENANCE_EVERY_MS = 6 * 60 * 60 * 1000
let lastMaintenance = 0

/**
 * Ask the web app to run the jobs that have to happen inside it — today, purging accounts
 * whose deletion grace period has expired.
 *
 * The worker is the only thing in this system with a clock, and that job had no caller at
 * all: readers were told "deletion scheduled for {date}" and nothing ever collected them.
 * Idempotent and cheap, so a restart re-running it is harmless.
 */
export const runMaintenance = async (now = Date.now()): Promise<boolean> => {
  if (now - lastMaintenance < MAINTENANCE_EVERY_MS) return false
  lastMaintenance = now
  const base = process.env.INTERNAL_URL || process.env.SITE_URL
  const secret = process.env.INTERNAL_API_SECRET ?? process.env.SESSION_SECRET
  if (!base || !secret) return false
  try {
    const res = await fetch(new URL('/api/internal/maintenance', base), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tasks: ['deletions'] }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      log.warn('maintenance failed', { status: res.status })
      return false
    }
    return true
  } catch (err) {
    log.warn('maintenance failed', { error: err instanceof Error ? err.message : String(err) })
    return false
  }
}
