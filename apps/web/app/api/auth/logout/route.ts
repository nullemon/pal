import { messages } from '@palscans/core/messages'
import { cookies } from 'next/headers'
import { z } from 'zod'
import {
  clearSessionCookie,
  csrfFailed,
  fail,
  MAX_JSON_BYTES,
  ok,
  readBody,
  revokeAllSessions,
  revokeSession,
  SESSION_COOKIE,
  sameOrigin,
} from '@/lib/auth'
import { resolveSession } from '@/lib/auth/session'

const bodySchema = z.object({ everywhere: z.boolean().optional() })

/**
 * POST /api/auth/logout {everywhere?} — revoke this session (or all of them) and clear the
 * cookie. Only a session whose secret verifies is revoked: the id half of the cookie alone
 * names nothing, so a guessed or leaked UUID cannot sign someone else out.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return csrfFailed()
  const read = await readBody(request, MAX_JSON_BYTES)
  if (!read.ok) return read.response
  const text = new TextDecoder().decode(read.body)
  let everywhere = false
  if (text.trim()) {
    try {
      everywhere = bodySchema.parse(JSON.parse(text)).everywhere === true
    } catch {
      return fail(400, 'invalid_json', messages.errors.validation)
    }
  }
  const store = await cookies()
  const resolved = await resolveSession(store.get(SESSION_COOKIE)?.value)
  if (resolved) {
    if (everywhere) await revokeAllSessions(resolved.user.id)
    else await revokeSession(resolved.sessionId)
  }
  await clearSessionCookie()
  return ok({ signedOut: true })
}
