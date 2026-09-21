import { can } from '@palscans/core'
import { getSessionUser, ok } from '@/lib/auth'

/**
 * `GET /api/me/summary` — who the viewer is, in the smallest shape the site chrome needs.
 *
 * The header cannot read the session itself. `app/(site)/layout.tsx` is deliberately free of
 * anything request-scoped so the series pages stay prerendered (the note at the top of that
 * file, and docs/06 "static shell + dynamic holes"); a `cookies()` read anywhere in that tree
 * would make every page below it dynamic. So the account button is a client island and this
 * is what it asks.
 *
 * Deliberately not the profile: no email, no entitlements, no permission list — an initial, a
 * name and one boolean. This is fetched on every page a signed-out visitor
 * loads too, so it answers `{ signedIn: false }` rather than 401: a 401 in the console on
 * every page view trains people to ignore the console.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const user = await getSessionUser()
  const headers = { 'Cache-Control': 'private, no-store' }
  if (!user) return ok({ signedIn: false }, { headers })

  // Username first: it is what the reader chose and what the site shows them everywhere
  // else. The email is the fallback for an account that has not picked one yet.
  const label = (user.username ?? user.email ?? '').trim()
  return ok(
    {
      signedIn: true,
      username: user.username ?? null,
      initial: (label[0] ?? '?').toUpperCase(),
      // `admin.access`, not `isStaff`: the panel's own gate is the permission
      // (app/admin/layout.tsx), and an uploader holds it without being staff. Checking the
      // role instead would hide the panel from the people who are in it every day.
      panel: can(user, 'admin.access'),
    },
    { headers },
  )
}
