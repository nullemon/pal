import { messages } from '@palscans/core/messages'
import { getDb, reports, users } from '@palscans/db'
import { and, count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { ReportsQueue } from '@/components/admin/client/ReportsQueue'
import { PAGE_SIZE, parseSearch, type SearchParams } from '@/components/admin/server/params'
import { PageHeader, Pagination } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

const schema = z.object({
  kind: z
    .enum(['comment', 'series_data', 'broken_chapter', 'site', 'dmca', 'request', 'contact'])
    .optional()
    .catch(undefined),
  status: z.enum(['open', 'triaged', 'actioned', 'rejected']).catch('open'),
  page: z.coerce.number().int().min(1).catch(1),
})

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
  const m = messages.admin.reportsQueue
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <ReportsQueue
        kind={p.kind ?? ''}
        status={p.status}
        items={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
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
