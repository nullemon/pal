import { log } from './log.js'

/**
 * Ask the web app to drop its cached catalog after the worker publishes something. The
 * worker runs in its own process, so `revalidateTag` is out of reach; the web app exposes
 * POST /api/internal/revalidate behind the shared `INTERNAL_API_SECRET` (default:
 * `SESSION_SECRET`). Best effort: a failure is logged, never thrown — the cache expires on
 * its own within the page's revalidate window.
 */
export const revalidateWeb = async (
  tags: Array<'catalog' | 'settings' | 'appearance'>,
): Promise<boolean> => {
  const base = process.env.SITE_URL
  const secret = process.env.INTERNAL_API_SECRET ?? process.env.SESSION_SECRET
  if (!base || !secret) {
    log.warn('revalidate skipped: SITE_URL or INTERNAL_API_SECRET/SESSION_SECRET unset', { tags })
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
