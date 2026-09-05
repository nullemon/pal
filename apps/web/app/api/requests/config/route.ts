import { ok } from '@/lib/auth'
import { getSessionUser } from '@/lib/auth/session'
import { turnstileSiteKey } from '@/lib/auth/turnstile'

/**
 * `GET /api/requests/config` — the two things the header modal needs before it can submit:
 * the public Turnstile site key (from the admin panel first, the environment second) and
 * whether the reader is signed in.
 *
 * This exists as an endpoint rather than a prop on the header because the site header is
 * deliberately synchronous: a database read there would make the home page and every series
 * page dynamic (see the note on `resolveConfig`). Fetching it when the modal first opens
 * costs one request for the readers who actually open it, and nothing at all for everyone
 * else.
 */
export async function GET() {
  const [siteKey, user] = await Promise.all([
    turnstileSiteKey(),
    getSessionUser().catch(() => null),
  ])
  return ok(
    { turnstileSiteKey: siteKey, signedIn: !!user },
    { headers: { 'cache-control': 'private, no-store' } },
  )
}
