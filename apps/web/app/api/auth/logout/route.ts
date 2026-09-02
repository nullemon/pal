import { messages } from '@palscans/core/messages'
import { cookies } from 'next/headers'
import { z } from 'zod'
import {
  clearSessionCookie,
  csrfFailed,
  fail,
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
  let everywhere = false
  if (text.trim()) {
    try {
      everywhere = bodySchema.parse(JSON.parse(text)).everywhere === true
    } catch {
      return fail(400, 'invalid_json', messages.errors.validation)
    }
  }
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
