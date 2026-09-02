import { messages } from '@palscans/core/messages'
import { getDb, sessions } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { clearSessionCookie, fail, getSessionId, ok, requireUser, revokeSession } from '@/lib/auth'

type Params = { id: string }

/** DELETE /api/me/sessions/:id — revoke one session (own sessions only). */
export const DELETE = requireUser<Params>(async (_request, ctx, user) => {
  const id = z.uuid().safeParse((await ctx.params).id)
  if (!id.success) return fail(404, 'not_found', messages.errors.notFound)
  const db = await getDb()
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, id.data), eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
    .limit(1)
  if (!row) return fail(404, 'not_found', messages.errors.notFound)
  await revokeSession(row.id)
  const current = (await getSessionId()) === row.id
  if (current) await clearSessionCookie()
  return ok({ revoked: true, current, message: messages.me.security.revoked })
})
