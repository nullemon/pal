import { normaliseLanguage } from '@palscans/core/languages'
import { chapters, getDb } from '@palscans/db'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { idParam } from '@/components/admin/server/params'
import { notFound, ok, withPermission } from '@/lib/auth'

/** GET /api/admin/series/:id/numbers — existing chapter numbers (uploader warnings). */
export const GET = withPermission<{ id: string }>('chapter.read', async (request, ctx) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  // Which numbers are taken depends on the language: chapter 1 existing in English says
  // nothing about whether a German chapter 1 would clash.
  const language = normaliseLanguage(new URL(request.url).searchParams.get('lang') ?? undefined)
  const db = await getDb()
  const rows = await db
    .select({
      id: chapters.id,
      number: chapters.number,
      state: chapters.state,
      pageCount: chapters.pageCount,
    })
    .from(chapters)
    .where(
      and(
        eq(chapters.seriesId, id.data),
        eq(chapters.language, language),
        isNull(chapters.deletedAt),
      ),
    )
    .orderBy(asc(chapters.number))
  return ok(rows)
})
