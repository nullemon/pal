import { can } from '@palscans/core'
import { getDb, series } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { chapterHref, formatChapterNumber } from '@/components/reader/params'
import { fail, notFound, type RouteParams } from '@/components/reader/server/auth'
import {
  chapterForApi,
  readerChapter,
  readerSeries,
  viewerCanRead,
} from '@/components/reader/server/data'
import { archiveFileName, cbzStream, chapterArchiveEntries } from '@/lib/archive/cbz'
import { clientIp, getRateLimiter, ipKey, rateLimited } from '@/lib/auth'
import { getSessionUser } from '@/lib/auth/session'
import { siteChrome } from '@/lib/chrome/load'
import { entitlementGate } from '@/lib/entitlements'
import { getEnv } from '@/lib/env'
import { getStorage } from '@/lib/storage'

const idSchema = z.coerce.number().int().positive()

/**
 * How many archives one viewer may pull in five minutes. Deliberately far tighter than the
 * offline payload's 20/minute: this route moves every page of a chapter through the
 * application server, which is the one thing docs/01 says image bytes should never do. It
 * is the price of handing the reader a real file, so the budget is small and per account.
 */
export const CBZ_LIMIT = 8
export const CBZ_WINDOW_SEC = 300

/**
 * GET /api/chapters/:id/cbz — the chapter as a CBZ the reader keeps.
 *
 * This is not the PWA's offline cache (`../offline`), which stores pages in the browser for
 * reading inside the app. This hands over a file: a ZIP of the page images in reading order
 * plus `ComicInfo.xml`, which every reader app opens.
 *
 * The gate is exactly the offline route's, and for the same reasons — both are decided here
 * rather than in the client: the viewer must hold `offline`, and must be able to read *this*
 * chapter. Premium and early-access chapters are included for a reader who is entitled to
 * them, which is the point of the entitlement.
 *
 * The response streams. Pages are read one at a time as the socket drains, so a 60-page
 * chapter at 1440px costs one page of memory rather than the whole archive; nothing is
 * buffered and nothing is cached, because the answer is per viewer.
 */
export async function GET(request: Request, ctx: RouteParams<{ id: string }>) {
  const id = idSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()

  const user = await getSessionUser()
  const ip = user ? null : ipKey(clientIp(request))
  const limitKey = user ? `cbz:u:${user.id}` : ip ? `cbz:ip:${ip}` : null
  if (limitKey) {
    const rate = await getRateLimiter().hit(limitKey, CBZ_LIMIT, CBZ_WINDOW_SEC)
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
  if (bundle.pages.length === 0) return fail(409, 'not_processed')

  const number = formatChapterNumber(bundle.chapter.number)
  const origin = (() => {
    try {
      return new URL(getEnv().SITE_URL).origin
    } catch {
      return new URL(request.url).origin
    }
  })()

  // `key` is the largest WebP the pipeline wrote (docs/03) — the widest variant, and the
  // format reader apps actually decode. AVIF is smaller but still unsupported in most of
  // them, so it would be a file that will not open.
  const storage = await getStorage()
  const entries = chapterArchiveEntries({
    keys: bundle.pages.map((p) => p.key),
    read: async (key) => (await storage.get(key)) ?? null,
    seriesTitle: owner.title,
    seriesSlug: owner.slug,
    number,
    chapterTitle: bundle.chapter.title,
    pageCount: bundle.pages.length,
    readingDirection: owner.readingDirection,
    url: `${origin}${chapterHref(owner.slug, bundle.chapter.number)}`,
    siteName: (await siteChrome()).brand.name,
  })

  const name = `${archiveFileName({ seriesSlug: owner.slug, number })}.cbz`
  const published = bundle.chapter.publishedAt ? new Date(bundle.chapter.publishedAt) : null
  return new Response(cbzStream(entries, { mtime: published ?? undefined }), {
    headers: {
      'content-type': 'application/vnd.comicbook+zip',
      'content-disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-page-count': String(bundle.pages.length),
    },
  })
}
