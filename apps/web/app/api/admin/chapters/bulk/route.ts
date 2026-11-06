import { adminMessages } from '@palscans/core/messages/admin'
import { chapters, getDb } from '@palscans/db'
import { and, inArray } from 'drizzle-orm'
import { bulkActionSchema } from '@/components/admin/schemas'
import { isChapterNumberConflict } from '@/components/admin/schemas-genres'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { publishChapters, scheduleChapters } from '@/components/admin/server/chapters'
import { setChapterGroups } from '@/components/admin/server/groups'
import { startWatermarkRun, WatermarkRunBusyError } from '@/components/admin/server/watermark'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * POST /api/admin/chapters/bulk — the bulk bar (docs/04): publish now · schedule · set/clear
 * premium · early-access window · delete/restore. Publish and schedule need chapter.publish;
 * the rest need chapter.update; delete needs chapter.delete.
 */
export const POST = withPermission('chapter.update', async (request, _ctx, user) => {
  const parsed = await parseJson(request, bulkActionSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const { can } = await import('@palscans/core')
  const needs =
    body.action === 'publish_now' || body.action === 'schedule'
      ? 'chapter.publish'
      : body.action === 'delete' || body.action === 'restore'
        ? 'chapter.delete'
        : body.action === 'reapply_watermark'
          ? 'chapter.repair'
          : 'chapter.update'
  if (!can(user, needs)) return Response.json({ error: 'forbidden' }, { status: 403 })

  const db = await getDb()
  const now = new Date()
  let affected: number[] = []
  /** Set only by `reapply_watermark`: the run the panel should follow. */
  let runId: string | null = null
  switch (body.action) {
    case 'publish_now':
      affected = await publishChapters(body.ids, now)
      break
    case 'schedule':
      affected = await scheduleChapters(body.ids, new Date(body.publishedAt), now)
      break
    case 'set_premium':
    case 'clear_premium':
      await db
        .update(chapters)
        .set({ isPremium: body.action === 'set_premium', updatedAt: now })
        .where(inArray(chapters.id, body.ids))
      affected = body.ids
      break
    case 'early_access':
      await db
        .update(chapters)
        .set({
          earlyAccessUntil: body.earlyAccessUntil ? new Date(body.earlyAccessUntil) : null,
          updatedAt: now,
        })
        .where(inArray(chapters.id, body.ids))
      affected = body.ids
      break
    // Replaces the credits rather than adding to them: the picker sends the whole answer, and
    // merging would make removing a wrong credit impossible from the only screen that sets one.
    case 'set_groups':
      await setChapterGroups(body.ids, body.groupIds, db)
      affected = body.ids
      break
    case 'credit_off':
    case 'credit_on':
      await db
        .update(chapters)
        .set({ creditDisabled: body.action === 'credit_off', updatedAt: now })
        .where(inArray(chapters.id, body.ids))
      affected = body.ids
      break
    case 'delete':
      await db
        .update(chapters)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(inArray(chapters.id, body.ids)))
      affected = body.ids
      break
    case 'restore':
      /**
       * Restoring can now fail, and that is the trade 9054 made.
       *
       * A deleted chapter no longer holds its number, so the number may have been given to
       * a chapter uploaded since — and bringing the old one back would put two live rows on
       * it. The partial unique index refuses, which is correct; what matters is that the
       * operator is told "that number is taken now" rather than shown a 500.
       */
      try {
        await db
          .update(chapters)
          .set({ deletedAt: null, updatedAt: now })
          .where(inArray(chapters.id, body.ids))
      } catch (error) {
        if (isChapterNumberConflict(error))
          return fail(409, 'number_taken', adminMessages.admin.chapters.bulk.restoreTaken)
        throw error
      }
      affected = body.ids
      break
    // Queued, not done here: re-marking even one chapter is a pile of CPU-bound encodes, and
    // the operator watches it on Appearance → Watermark like any other run.
    case 'reapply_watermark':
      try {
        runId = (await startWatermarkRun(body.ids, user.id)).id
        affected = body.ids
      } catch (err) {
        if (err instanceof WatermarkRunBusyError) return fail(409, 'conflict')
        throw err
      }
      break
  }
  await audit({
    actorId: user.id,
    action: `chapter.bulk.${body.action}`,
    targetType: 'chapter',
    targetId: affected[0] ?? null,
    before: { ids: body.ids },
    after: {
      affected,
      ...(runId ? { runId } : {}),
      ...('publishedAt' in body ? { publishedAt: body.publishedAt } : {}),
      ...('earlyAccessUntil' in body ? { earlyAccessUntil: body.earlyAccessUntil } : {}),
    },
  })
  purgeCatalog()
  return ok({ affected, runId })
})
