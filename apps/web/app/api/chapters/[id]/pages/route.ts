import { can } from '@palscans/core'
import { getDb, series } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { fail, notFound, ok, type RouteParams } from '@/components/reader/server/auth'
import {
  chapterForApi,
  readerChapter,
  readerSeries,
  toReaderPages,
  viewerCanRead,
} from '@/components/reader/server/data'
import { getSessionUser } from '@/lib/auth/session'

const idSchema = z.coerce.number().int().positive()
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).catch(50) })

/**
 * GET /api/chapters/:id/pages?limit=3 — the page manifest the reader prefetches for the
 * next chapter at 80% (docs/06). Access is decided by `canReadChapter`; a locked chapter
 * answers 403 with the lock kind and never a page URL. Anonymous readers may fetch free
 * chapters (the reader itself is public), which is why this is not behind `requireUser`.
 */
export async function GET(request: Request, ctx: RouteParams<{ id: string }>) {
  const id = idSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  const limit = query.success ? query.data.limit : 50

  const row = await chapterForApi(id.data)
  if (!row) return notFound()
  const user = await getSessionUser()
  const staff = can(user, 'chapter.read')
  const db = await getDb()
  const [s] = await db
    .select({ slug: series.slug })
    .from(series)
    .where(eq(series.id, row.seriesId))
    .limit(1)
  if (!s) return notFound()
  const owner = await readerSeries(s.slug, staff)
  if (!owner) return notFound()
  const bundle = await readerChapter(owner.id, Number(row.number), staff)
  if (!bundle) return notFound()
  const now = new Date()
  if (!viewerCanRead(user, bundle.chapter, now)) return fail(403, 'locked')
  const pages = toReaderPages(bundle.pages).slice(0, limit)
  return ok(
    {
      chapterId: bundle.chapter.id,
      number: bundle.chapter.number,
      pageCount: bundle.chapter.pageCount,
      pages,
    },
    { headers: { 'cache-control': 'private, max-age=60' } },
  )
}
