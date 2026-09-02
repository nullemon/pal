import { fmt, messages } from '@palscans/core/messages'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { fail, getSessionId, ok, parseJson, requireUser, revokeAllSessions } from '@/lib/auth'
import { verifyPassword } from '@/lib/auth/password'
import { deleteAccountSchema } from '@/lib/auth/schemas'
import { deletionPurgeAt, findUserById } from '@/lib/auth/users'
import { deletionScheduledMail, getMailer } from '@/lib/email'

/**
 * POST /api/me/delete {password?} — schedule deletion (docs/13: 14-day grace; the worker
 * purges after `deletion_requested_at + 14d`, anonymising comments). DELETE — cancel.
 */
export const POST = requireUser(async (request, _ctx, user) => {
  const parsed = await parseJson(request, deleteAccountSchema)
  if (!parsed.ok) return parsed.response
  const row = await findUserById(user.id)
  if (!row) return fail(404, 'not_found', messages.errors.notFound)
  if (row.passwordHash) {
    if (!parsed.data.password || !(await verifyPassword(row.passwordHash, parsed.data.password)))
      return fail(400, 'wrong_password', messages.me.security.wrongPassword)
  }
  const requestedAt = new Date()
  const purgeAt = deletionPurgeAt(requestedAt) as Date
  const db = await getDb()
  await db
    .update(users)
    .set({ deletionRequestedAt: requestedAt, updatedAt: new Date() })
    .where(eq(users.id, user.id))
  await revokeAllSessions(user.id, (await getSessionId()) ?? undefined)
  await getMailer().send(deletionScheduledMail(row.email, purgeAt))
  return ok({
    scheduled: true,
    purgeAt: purgeAt.toISOString(),
    message: fmt(messages.me.settings.deleteScheduled, {
      date: purgeAt.toISOString().slice(0, 10),
    }),
  })
})

export const DELETE = requireUser(async (_request, _ctx, user) => {
  const db = await getDb()
  await db
    .update(users)
    .set({ deletionRequestedAt: null, updatedAt: new Date() })
    .where(eq(users.id, user.id))
  return ok({ scheduled: false, message: messages.me.settings.deleteCancelled })
})
