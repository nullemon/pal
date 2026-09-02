import { messages } from '@palscans/core/messages'
import { getDb, notifications } from '@palscans/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { ok, parseJson, requireUser } from '@/lib/auth'
import { notificationsReadSchema } from '@/lib/auth/schemas'

/** POST /api/me/notifications {ids?} — mark the given (or all) notifications read. */
export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, notificationsReadSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const where = parsed.data.ids?.length
    ? and(
        eq(notifications.userId, user.id),
        isNull(notifications.readAt),
        inArray(notifications.id, parsed.data.ids),
      )
    : and(eq(notifications.userId, user.id), isNull(notifications.readAt))
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(where)
    .returning({ id: notifications.id })
  return ok({ read: rows.length, message: messages.me.notifications.markedRead })
})
