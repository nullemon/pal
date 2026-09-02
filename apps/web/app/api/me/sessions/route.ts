import { fmt, messages } from '@palscans/core/messages'
import { getSessionId, listSessions, ok, requireUser, revokeAllSessions } from '@/lib/auth'

/** GET /api/me/sessions — active sessions; DELETE — sign out everywhere else. */
export const GET = requireUser(async (_request, _ctx, user) => {
  const sessions = await listSessions(user.id, await getSessionId())
  return ok({ sessions })
})

export const DELETE = requireUser(async (_request, _ctx, user) => {
  const current = await getSessionId()
  const n = await revokeAllSessions(user.id, current ?? undefined)
  return ok({ revoked: n, message: fmt(messages.me.security.revokedAll, { n }) })
})
