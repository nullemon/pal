import { chapters, getDb } from '@palscans/db'
import { and, eq, isNull, lte } from 'drizzle-orm'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { publishChapters } from '@/components/admin/server/chapters'
import { ok, withPermission } from '@/lib/auth'

/** POST /api/admin/jobs/run-scheduler — publish every due scheduled chapter now (the worker does this every 30 s). */
export const POST = withPermission('chapter.publish', async (request, _ctx, user) => {
  const db = await getDb()
  const due = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(
      and(
        eq(chapters.state, 'scheduled'),
        lte(chapters.publishedAt, new Date()),
        isNull(chapters.deletedAt),
      ),
    )
    .limit(200)
  const published = await publishChapters(due.map((d) => d.id))
  if (published.length) purgeCatalog()
  await audit({
    actorId: user.id,
    action: 'jobs.run_scheduler',
    targetType: 'chapter',
    targetId: published[0] ?? null,
    after: { published },
    request,
  })
  return ok({ published })
})
