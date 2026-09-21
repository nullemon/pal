import { chapters, getDb } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { enqueueProcess } from '@/components/admin/server/chapters'
import { idParam } from '@/components/admin/server/params'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'

const schema = z.object({ failedOnly: z.boolean().default(true) })

/** POST /api/admin/chapters/:id/retry { failedOnly } — docs/03 "retry failed pages only". */
export const POST = withPermission<{ id: string }>('chapter.repair', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, schema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const [row] = await db
    .select({ state: chapters.state, processing: chapters.processing })
    .from(chapters)
    .where(eq(chapters.id, id.data))
    .limit(1)
  if (!row) return notFound()
  if (!row.processing || row.processing.sources.length === 0) return fail(400, 'no_sources')
  if (row.state === 'processing') return fail(409, 'already_processing')
  const failedOnly = parsed.data.failedOnly && Object.keys(row.processing.errors).length > 0
  const attempt = row.processing.attempt + 1
  await db
    .update(chapters)
    .set({
      state: 'processing',
      processing: {
        ...row.processing,
        attempt,
        mode: failedOnly ? 'failed' : 'all',
        startedAt: null,
        finishedAt: null,
      },
      updatedAt: new Date(),
    })
    .where(eq(chapters.id, id.data))
  const jobId = await enqueueProcess(id.data, attempt)
  await audit({
    actorId: user.id,
    action: 'chapter.retry',
    targetType: 'chapter',
    targetId: id.data,
    after: { failedOnly, attempt, jobId },
  })
  return ok({ jobId, attempt })
})
