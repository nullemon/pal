import { getDb, markSeriesRead, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { getSessionUser } from '@/lib/auth/session'

/**
 * POST /api/series/:id/read-all — mark every published chapter of a series as read.
 *
 * The chore it removes: catching up on a long series elsewhere, then coming back to forty
 * unread markers that each have to be opened to clear.
 *
 * Signed in only, and deliberately not offered to anonymous readers: their progress lives in
 * their own browser (`lib/progress`), where the client marks it without a round trip.
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getSessionUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const id = Number((await ctx.params).id)
  if (!Number.isInteger(id) || id <= 0)
    return Response.json({ error: 'not_found' }, { status: 404 })

  const db = await getDb()
  // The series has to be one a reader could actually see: marking an unpublished one read
  // would write history for chapters that may never go live.
  const [row] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.id, id), eq(series.state, 'published'), isNull(series.deletedAt)))
    .limit(1)
  if (!row) return Response.json({ error: 'not_found' }, { status: 404 })

  const result = await markSeriesRead(db, user.id, id)
  return Response.json({ data: result }, { headers: { 'cache-control': 'no-store' } })
}
