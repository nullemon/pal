import { can } from '@palscans/core'
import { getDb, series } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { fail, notFound, ok, type RouteParams } from '@/components/reader/server/auth'
import {
  chapterForApi,
  readerChapter,
  readerChapterList,
  readerSeries,
  viewerCanRead,
} from '@/components/reader/server/data'
import { buildReaderData } from '@/components/reader/server/payload'
import { cachedReaderSiteSettings } from '@/components/reader/server/settings'
import { clientIp, getRateLimiter, ipKey, rateLimited } from '@/lib/auth'
import { getSessionUser } from '@/lib/auth/session'
import { entitlementGate } from '@/lib/entitlements'

const idSchema = z.coerce.number().int().positive()

/**
 * GET /api/chapters/:id/offline — the full reader payload for a download (docs/06 "Progress
 * and offline", docs/17 §G).
 *
 * Two gates, both here rather than in the client: the viewer must hold `offline`, and must
 * be able to read *this* chapter. A locked chapter the reader is entitled to comes back with
 * signed URLs, which is the point — a Premium reader downloads a Premium chapter and keeps
 * it. Never cached: the payload is per viewer and carries signed URLs.
 */
export async function GET(request: Request, ctx: RouteParams<{ id: string }>) {
  const id = idSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()

  const user = await getSessionUser()
  // Downloading is far heavier than a page view, so it gets its own, tighter budget.
  const ip = user ? null : ipKey(clientIp(request))
  const limitKey = user ? `offline:u:${user.id}` : ip ? `offline:ip:${ip}` : null
  if (limitKey) {
    const rate = await getRateLimiter().hit(limitKey, 20, 60)
    if (!rate.ok) return rateLimited(rate.retryAfterSec)
  }

  const now = new Date()
  const gate = await entitlementGate()
  if (!gate.can('offline', user, now)) return fail(403, 'offline_not_entitled')

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
  if (!viewerCanRead(user, bundle.chapter, { overrides: gate.overrides, now }))
    return fail(403, 'locked')

  const [list, site] = await Promise.all([
    readerChapterList(owner.id, now),
    cachedReaderSiteSettings(),
  ])
  const { data, coverUrl } = await buildReaderData({
    user,
    series: owner,
    bundle,
    list,
    gate,
    site,
    now,
  })

  return ok({ data, coverUrl }, { headers: { 'cache-control': 'private, no-store' } })
}
