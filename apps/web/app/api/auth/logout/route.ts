import { cookies } from 'next/headers'
import { z } from 'zod'
import {
  clearSessionCookie,
  csrfFailed,
  ok,
  parseSessionCookie,
  revokeAllSessions,
  revokeSession,
  SESSION_COOKIE,
  sameOrigin,
} from '@/lib/auth'
import { resolveSession } from '@/lib/auth/session'

const bodySchema = z.object({ everywhere: z.boolean().optional() })

/** POST /api/auth/logout {everywhere?} — revoke this session (or all of them) and clear the cookie. */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return csrfFailed()
  const text = await request.text()
  const body = text.trim()
    ? bodySchema.safeParse(JSON.parse(text))
    : { success: true as const, data: {} }
  const everywhere = body.success ? body.data.everywhere === true : false
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE)?.value
  const parsed = parseSessionCookie(raw)
  if (parsed) {
    if (everywhere) {
      const resolved = await resolveSession(raw)
      if (resolved) await revokeAllSessions(resolved.user.id)
      else await revokeSession(parsed.id)
    } else {
      await revokeSession(parsed.id)
    }
  }
  await clearSessionCookie()
  return ok({ signedOut: true })
}
