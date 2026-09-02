import { chapters, getDb } from '@palscans/db'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { idParam } from '@/components/admin/server/params'
import { notFound, ok, withPermission } from '@/lib/auth'

/** GET /api/admin/series/:id/numbers — existing chapter numbers (uploader warnings). */
export const GET = withPermission<{ id: string }>('chapter.read', async (_request, ctx) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const db = await getDb()
  const rows = await db
    .select({
      id: chapters.id,
      number: chapters.number,
      state: chapters.state,
      pageCount: chapters.pageCount,
    })
    .from(chapters)
    .where(and(eq(chapters.seriesId, id.data), isNull(chapters.deletedAt)))
    .orderBy(asc(chapters.number))
  return ok(rows)
})
