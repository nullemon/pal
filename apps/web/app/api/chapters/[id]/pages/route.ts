import { can } from '@palscans/core'
import { getDb, series } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { fail, notFound, ok, type RouteParams } from '@/components/reader/server/auth'
import {
  chapterForApi,
  lockOf,
  readerChapter,
  readerSeries,
  toReaderPages,
  viewerCanRead,
} from '@/components/reader/server/data'
import { clientIp, getRateLimiter, ipKey, rateLimited } from '@/lib/auth'
import { getSessionUser } from '@/lib/auth/session'
import { entitlementGate } from '@/lib/entitlements'

const idSchema = z.coerce.number().int().positive()
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).catch(50) })

/**
 * GET /api/chapters/:id/pages?limit=3 — the page manifest the reader prefetches for the
 * next chapter at 80% (docs/06). Access is decided by `canReadChapter`; a locked chapter
 * answers 403 with the lock kind and never a page URL; an entitled reader of a locked
 * chapter gets URLs signed for 10 minutes and an uncacheable response (docs/03). Anonymous
 * readers may fetch free chapters (the reader itself is public), which is why this is not
 * behind `requireUser`.
 */
export async function GET(request: Request, ctx: RouteParams<{ id: string }>) {
  const id = idSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  const limit = query.success ? query.data.limit : 50

  // docs/07: page-manifest fetches are limited to 60/min per user (or per IP when anonymous)
  const user = await getSessionUser()
  const ip = user ? null : ipKey(clientIp(request))
  const limitKey = user ? `manifest:u:${user.id}` : ip ? `manifest:ip:${ip}` : null
  if (limitKey) {
    const rate = await getRateLimiter().hit(limitKey, 60, 60)
    if (!rate.ok) return rateLimited(rate.retryAfterSec)
  }

  const row = await chapterForApi(id.data)
  if (!row) return notFound()
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
  const gate = await entitlementGate()
  if (!viewerCanRead(user, bundle.chapter, { overrides: gate.overrides, now }))
    return fail(403, 'locked')
  const lock = lockOf(bundle.chapter, now)
  const pages = (await toReaderPages(bundle.pages.slice(0, limit), lock)).slice(0, limit)
  return ok(
    {
      chapterId: bundle.chapter.id,
      number: bundle.chapter.number,
      pageCount: bundle.chapter.pageCount,
      pages,
    },
    {
      headers: {
        'cache-control': lock === 'none' ? 'private, max-age=60' : 'private, no-store',
      },
    },
  )
}
