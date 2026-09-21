import { messages } from '@palscans/core/messages'
import { chapters, getDb, reports, series } from '@palscans/db'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { CHAPTER_REPORT_REASONS, MAX_NOTE } from '@/components/reader/report'
import { csrfFailed, fail, notFound, ok, parseJson, rateLimited, sameOrigin } from '@/lib/auth'
import { clientIp, getRateLimiter, ipKey } from '@/lib/auth/rate-limit'
import { getSessionUser } from '@/lib/auth/session'
import { getEnv } from '@/lib/env'
import { ensureVisitorId, visitorKeyFor } from '@/lib/visitor'

/**
 * POST /api/reports/chapter — "this chapter is broken".
 *
 * A missing page, pages in the wrong order, the wrong chapter behind a number, a scan
 * nobody can read: the reader who hits one has, until now, had nowhere to say so, and the
 * readers most likely to hit one are the signed-out majority. So this route takes an
 * anonymous report. It is still same-origin only (docs/07) and still rate limited — by
 * address when one is known, because that is the only handle an anonymous reporter has.
 *
 * Reports land in the one existing `reports` queue (docs/04) as `kind = 'broken_chapter'`,
 * `target_type = 'chapter'`, so `/admin/reports` shows them beside comment and DMCA
 * tickets with no second system to work.
 */

export const chapterReportSchema = z.object({
  chapterId: z.number().int().positive(),
  reason: z.enum(CHAPTER_REPORT_REASONS),
  /** Optional free text. Trimmed; empty becomes null rather than an empty row. */
  note: z.string().max(MAX_NOTE).optional(),
  /** 0-based index of the page the reader was on, so a moderator can go straight to it. */
  pageIdx: z.number().int().min(0).max(4000).optional(),
})

/** Per address: enough for a reader who finds three broken chapters in a sitting. */
export const REPORTS_PER_HOUR = 5
/**
 * With `TRUSTED_PROXY=none` no address is known. Pooling every reporter into one bucket
 * would let a single abuser mute the whole site, so the shared bucket is deliberately
 * loose — a cap on a flood, not a limit any real reader can reach.
 */
export const ANONYMOUS_POOL_PER_HOUR = 200
/** A second report on the same chapter within this window is the same complaint. */
export const DEDUPE_WINDOW_MS = 24 * 3600 * 1000

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return csrfFailed()
  const parsed = await parseJson(request, chapterReportSchema)
  if (!parsed.ok) return parsed.response

  const user = await getSessionUser()
  const ip = clientIp(request)
  const key = ipKey(ip)
  const limiter = getRateLimiter()
  const limit = user
    ? await limiter.hit(`report-chapter:u:${user.id}`, REPORTS_PER_HOUR * 2, 3600)
    : key
      ? await limiter.hit(`report-chapter:ip:${key}`, REPORTS_PER_HOUR, 3600)
      : await limiter.hit('report-chapter:anon', ANONYMOUS_POOL_PER_HOUR, 3600)
  if (!limit.ok) return rateLimited(limit.retryAfterSec)

  const db = await getDb()
  const [chapter] = await db
    .select({
      id: chapters.id,
      number: chapters.number,
      title: chapters.title,
      pageCount: chapters.pageCount,
      seriesId: series.id,
      seriesSlug: series.slug,
      seriesTitle: series.title,
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(
        eq(chapters.id, parsed.data.chapterId),
        eq(chapters.state, 'published'),
        isNull(chapters.deletedAt),
        isNull(series.deletedAt),
      ),
    )
    .limit(1)
  if (!chapter) return notFound()

  const note = parsed.data.note?.trim() || null
  const number = Number(chapter.number)

  // Five readers reporting the same broken chapter is signal worth five rows; one reader
  // tapping Report five times is one. `reporter_key` (migration 9038) is what tells them
  // apart for an anonymous reporter — an HMAC of their visitor cookie, not of their address.
  const reporterKey = user
    ? null
    : Buffer.from(visitorKeyFor('rp:v1', await ensureVisitorId(), getEnv().SESSION_SECRET))
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS)
  const mine = user
    ? eq(reports.reporterId, user.id)
    : reporterKey
      ? sql`${reports.reporterKey} = ${reporterKey}`
      : null
  if (mine) {
    const [duplicate] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.kind, 'broken_chapter'),
          eq(reports.targetId, chapter.id),
          eq(reports.status, 'open'),
          gt(reports.createdAt, since),
          mine,
        ),
      )
      .orderBy(desc(reports.createdAt))
      .limit(1)
    if (duplicate) return ok({ id: duplicate.id, message: messages.chapterReport.thanks })
  }

  const [row] = await db
    .insert(reports)
    .values({
      kind: 'broken_chapter',
      targetType: 'chapter',
      targetId: chapter.id,
      reporterId: user?.id ?? null,
      reason: parsed.data.reason,
      detail: note,
      reporterKey: reporterKey ? new Uint8Array(reporterKey) : null,
      // Everything a moderator needs to act without opening the reader themselves.
      payload: {
        series_id: chapter.seriesId,
        series: chapter.seriesTitle,
        series_slug: chapter.seriesSlug,
        chapter_id: chapter.id,
        chapter_number: number,
        chapter_title: chapter.title,
        // 1-based, the number printed in the reader — not the array index.
        page: parsed.data.pageIdx === undefined ? null : parsed.data.pageIdx + 1,
        page_count: chapter.pageCount,
        signed_in: !!user,
        href: `/series/${chapter.seriesSlug}/chapter-${Number.parseFloat(number.toFixed(3))}`,
      },
    })
    .returning({ id: reports.id })
  if (!row) return fail(500, 'insert_failed', messages.errors.serverError)
  return ok({ id: row.id, message: messages.chapterReport.thanks })
}
