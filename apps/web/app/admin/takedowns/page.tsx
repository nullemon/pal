import { messages } from '@palscans/core/messages'
import { auditLog, chapters, getDb, series, takedowns, users } from '@palscans/db'
import { and, count, desc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import {
  PAGE_SIZE,
  pageSchema,
  parseSearch,
  type SearchParams,
} from '@/components/admin/server/params'
import { PageHeader, Pagination } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { TakedownsQueue } from './TakedownsQueue'

/**
 * Admin → Community → Takedowns (docs/07 "Content compliance": takedown handling is "a
 * feature with a UI, an SLA, and an audit trail — not an inbox someone checks").
 *
 * The `/dmca` form writes each notice into `takedowns`; this is the queue that works through
 * them. Status is derived from the two columns the ledger actually has rather than a status
 * column, so the list and the row can never disagree about where a notice stands.
 */

const STATUS = ['open', 'received', 'acknowledged', 'closed', 'all'] as const
type Status = (typeof STATUS)[number]

const schema = z.object({
  status: z.enum(STATUS).catch('open'),
  page: pageSchema,
})

const whereFor = (status: Status): SQL | undefined => {
  if (status === 'all') return undefined
  if (status === 'closed') return isNotNull(takedowns.actionedAt)
  if (status === 'acknowledged')
    return and(isNull(takedowns.actionedAt), eq(takedowns.action, 'acknowledged'))
  if (status === 'received') return and(isNull(takedowns.actionedAt), isNull(takedowns.action))
  // open = everything still on the clock, acknowledged or not
  return isNull(takedowns.actionedAt)
}

export default async function TakedownsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await withPermission('report.handle', { returnTo: '/admin/takedowns' })
  const p = parseSearch(schema, await searchParams)
  const db = await getDb()
  const where = whereFor(p.status)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: takedowns.id,
        claimant: takedowns.claimant,
        claimantEmail: takedowns.claimantEmail,
        noticeBody: takedowns.noticeBody,
        receivedAt: takedowns.receivedAt,
        actionedAt: takedowns.actionedAt,
        action: takedowns.action,
        counterNotice: takedowns.counterNotice,
        seriesId: takedowns.seriesId,
        seriesTitle: series.title,
        seriesSlug: series.slug,
        chapterId: takedowns.chapterId,
        chapterNumber: chapters.number,
        actionedBy: users.username,
      })
      .from(takedowns)
      .leftJoin(series, eq(series.id, takedowns.seriesId))
      .leftJoin(chapters, eq(chapters.id, takedowns.chapterId))
      .leftJoin(users, eq(users.id, takedowns.createdBy))
      .where(where)
      .orderBy(desc(takedowns.receivedAt), desc(takedowns.id))
      .limit(PAGE_SIZE)
      .offset((p.page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(takedowns).where(where),
  ])

  // The staff note lives on the audit row, not on the ledger — one query for the whole page
  // rather than one per expanded notice.
  const ids = rows.map((r) => r.id)
  const trail = ids.length
    ? await db
        .select({
          targetId: auditLog.targetId,
          action: auditLog.action,
          after: auditLog.after,
          createdAt: auditLog.createdAt,
          actor: users.username,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorId))
        .where(and(eq(auditLog.targetType, 'takedown'), inArray(auditLog.targetId, ids)))
        .orderBy(desc(auditLog.createdAt))
        .limit(PAGE_SIZE * 8)
    : []

  const m = messages.takedowns
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <TakedownsQueue
        status={p.status}
        items={rows.map((r) => ({
          ...r,
          chapterNumber: r.chapterNumber === null ? null : Number(r.chapterNumber),
          receivedAt: r.receivedAt.toISOString(),
          actionedAt: r.actionedAt?.toISOString() ?? null,
        }))}
        trail={trail.map((t) => ({
          takedownId: Number(t.targetId),
          action: t.action,
          note:
            t.after && typeof t.after === 'object' && 'note' in t.after
              ? ((t.after as { note?: unknown }).note as string | null)
              : null,
          actor: t.actor,
          createdAt: t.createdAt.toISOString(),
        }))}
      />
      <Pagination
        page={p.page}
        pages={Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE))}
        hrefFor={(n) => `/admin/takedowns?status=${p.status}&page=${n}`}
      />
    </>
  )
}
