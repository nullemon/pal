import { entitlement } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { comments, db, reports } from '@palscans/db'
import { and, eq, sql } from 'drizzle-orm'
import { notFound, ok, parseJson, requireUser } from '@/lib/comments/http'
import { getCommentRow } from '@/lib/comments/queries'
import { idParamSchema, reportSchema } from '@/lib/comments/schemas'
import { loadCommentSettings } from '@/lib/comments/settings'

type Params = { id: string }

/**
 * POST /api/comments/:id/report {reason, detail?} — one report per reporter per comment;
 * the comment auto-hides (→ pending) past the docs/14 §3 threshold.
 */
export const POST = requireUser<Params>(async (request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, reportSchema)
  if (!parsed.ok) return parsed.response
  const row = await getCommentRow(db, id.data)
  if (!row || row.deletedAt) return notFound()

  const [existing] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.kind, 'comment'),
        eq(reports.targetType, 'comment'),
        eq(reports.targetId, row.id),
        eq(reports.reporterId, user.id),
      ),
    )
    .limit(1)
  if (!existing)
    await db.insert(reports).values({
      kind: 'comment',
      targetType: 'comment',
      targetId: row.id,
      reporterId: user.id,
      reason: parsed.data.reason,
      detail: parsed.data.detail || null,
      payload: { seriesId: row.seriesId, chapterId: row.chapterId, authorId: row.userId },
    })

  const settings = await loadCommentSettings(db)
  const [count] = await db
    .select({ n: sql<number>`count(distinct ${reports.reporterId})::int` })
    .from(reports)
    .where(
      and(
        eq(reports.targetType, 'comment'),
        eq(reports.targetId, row.id),
        eq(reports.status, 'open'),
      ),
    )
  const unique = Number(count?.n ?? 0)
  const premiumReporter = entitlement(user, 'premium_content') || user.role === 'premium'
  const hide =
    row.status === 'published' &&
    (unique >= settings.report_threshold.unique ||
      (premiumReporter && unique >= settings.report_threshold.premium))
  if (hide) await db.update(comments).set({ status: 'pending' }).where(eq(comments.id, row.id))

  return ok({ id: row.id, message: messages.commentThread.reported })
})
