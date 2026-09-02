import { messages } from '@palscans/core/messages'
import { chapterReads, getDb, readingProgress } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { ok, requireUser } from '@/lib/auth'

/** DELETE /api/me/history — clear reading history and resume points. */
export const DELETE = requireUser(async (_request, _ctx, user) => {
  const db = await getDb()
  await db.delete(chapterReads).where(eq(chapterReads.userId, user.id))
  await db.delete(readingProgress).where(eq(readingProgress.userId, user.id))
  return ok({ cleared: true, message: messages.me.history.cleared })
})
