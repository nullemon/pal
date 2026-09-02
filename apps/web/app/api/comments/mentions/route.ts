import { db, users } from '@palscans/db'
import { and, ilike, isNotNull, isNull, sql } from 'drizzle-orm'
import { ok, parseQuery, requireUser } from '@/lib/comments/http'
import { storageUrl } from '@/lib/comments/media'
import { mentionQuerySchema } from '@/lib/comments/schemas'

/** GET /api/comments/mentions?q=kae — username typeahead for the composer (signed-in only). */
export const GET = requireUser(async (request) => {
  const q = parseQuery(request, mentionQuerySchema)
  if (!q.ok) return q.response
  const prefix = q.data.q.replace(/^@/, '').replace(/[%_]/g, '')
  if (!prefix) return ok({ users: [] })
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
    })
    .from(users)
    .where(
      and(isNotNull(users.username), isNull(users.deletedAt), ilike(users.username, `${prefix}%`)),
    )
    .orderBy(sql`length(${users.username})`, users.username)
    .limit(8)
  return ok({
    users: rows.map((r) => ({
      id: r.id,
      username: r.username ?? '',
      displayName: r.displayName ?? r.username ?? '',
      avatarUrl: storageUrl(r.avatarKey),
    })),
  })
})
