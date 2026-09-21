import { getDb, reports } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { reportActionSchema } from '@/components/admin/schemas-moderation'
import { audit } from '@/components/admin/server/audit'
import { idParam } from '@/components/admin/server/params'
import { notFound, ok, parseJson, withPermission } from '@/lib/auth'

/** POST /api/admin/reports/:id { action: dismiss | actioned | triaged } */
export const POST = withPermission<{ id: string }>('report.handle', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, reportActionSchema)
  if (!parsed.ok) return parsed.response
  const status = parsed.data.action === 'dismiss' ? 'rejected' : parsed.data.action
  const db = await getDb()
  const [before] = await db
    .select({ status: reports.status })
    .from(reports)
    .where(eq(reports.id, id.data))
    .limit(1)
  if (!before) return notFound()
  await db
    .update(reports)
    .set({ status, handledBy: user.id, handledAt: new Date() })
    .where(eq(reports.id, id.data))
  await audit({
    actorId: user.id,
    action: `report.${parsed.data.action}`,
    targetType: 'report',
    targetId: id.data,
    before,
    after: { status },
  })
  return ok({ id: id.data, status })
})
