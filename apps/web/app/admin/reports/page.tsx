import { messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { getDb, reports, users } from '@palscans/db'
import { and, count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { ReportsQueue } from '@/components/admin/client/ReportsQueue'
import {
  PAGE_SIZE,
  pageSchema,
  parseSearch,
  type SearchParams,
} from '@/components/admin/server/params'
import { PageHeader, Pagination } from '@/components/admin/ui'
import { CHAPTER_REPORT_REASONS, type ChapterReportReason } from '@/components/reader/report'
import { withPermission } from '@/lib/auth'

const schema = z.object({
  kind: z
    .enum(['comment', 'series_data', 'broken_chapter', 'site', 'dmca', 'request', 'contact'])
    .optional()
    .catch(undefined),
  status: z.enum(['open', 'triaged', 'actioned', 'rejected']).catch('open'),
  page: pageSchema,
})

/**
 * A `broken_chapter` report stores its reason as a code (`missing_page`), so the queue can
 * be counted and filtered by it and a reworded label never orphans old rows. The queue is
 * read by a person, though, so the code is turned back into the sentence the reader picked
 * here, on the way out. Anything unrecognised — an older row, another kind of report —
 * passes through untouched.
 */
const isChapterReason = (v: string): v is ChapterReportReason =>
  (CHAPTER_REPORT_REASONS as readonly string[]).includes(v)

const reasonLabel = (kind: string, reason: string): string =>
  kind === 'broken_chapter' && isChapterReason(reason)
    ? messages.chapterReport.reasons[reason]
    : reason

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await withPermission('report.handle', { returnTo: '/admin/reports' })
  const p = parseSearch(schema, await searchParams)
  const db = await getDb()
  const where = and(eq(reports.status, p.status), p.kind ? eq(reports.kind, p.kind) : undefined)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: reports.id,
        kind: reports.kind,
        targetType: reports.targetType,
        targetId: reports.targetId,
        reason: reports.reason,
        detail: reports.detail,
        payload: reports.payload,
        status: reports.status,
        createdAt: reports.createdAt,
        reporter: users.username,
        reporterEmail: reports.reporterEmail,
      })
      .from(reports)
      .leftJoin(users, eq(users.id, reports.reporterId))
      .where(where)
      .orderBy(desc(reports.createdAt))
      .limit(PAGE_SIZE)
      .offset((p.page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(reports).where(where),
  ])
  const m = adminMessages.admin.reportsQueue
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <ReportsQueue
        kind={p.kind ?? ''}
        status={p.status}
        items={rows.map((r) => ({
          ...r,
          reason: reasonLabel(r.kind, r.reason),
          createdAt: r.createdAt.toISOString(),
        }))}
      />
      <Pagination
        page={p.page}
        pages={Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE))}
        hrefFor={(n) =>
          `/admin/reports?status=${p.status}${p.kind ? `&kind=${p.kind}` : ''}&page=${n}`
        }
      />
    </>
  )
}
