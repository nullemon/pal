import { messages } from '@palscans/core/messages'
import {
  getDb,
  listRequests,
  mergedInto,
  type RequestFilter,
  requestStatusCounts,
  users,
} from '@palscans/db'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  PAGE_SIZE,
  pageSchema,
  parseSearch,
  type SearchParams,
} from '@/components/admin/server/params'
import { PageHeader, Pagination, StatTile } from '@/components/admin/ui'
import { REQUEST_FILTERS } from '@/components/requests/shared'
import { withPermission } from '@/lib/auth'
import { RequestsQueue } from './RequestsQueue'

/**
 * Admin → Community → Series requests.
 *
 * The queue is ordered by votes by default, because that is the only ordering that answers
 * the question the board exists to answer: *what do readers actually want?* A request with
 * two hundred votes and a request with one look identical in an inbox; here they do not.
 *
 * `report.handle` — the permission moderators already hold for the reports queue and the
 * DMCA ledger — rather than a new one, so no existing role has to be edited before staff can
 * do work they are plainly already trusted with.
 */

const schema = z.object({
  status: z.enum(REQUEST_FILTERS).catch('open'),
  sort: z.enum(['votes', 'new']).catch('votes'),
  q: z.string().trim().max(100).catch(''),
  page: pageSchema,
})

const m = messages.requests.admin

export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await withPermission('report.handle', { returnTo: '/admin/requests' })
  const p = parseSearch(schema, await searchParams)
  const db = await getDb()
  const [page, counts] = await Promise.all([
    listRequests(db, {
      filter: p.status as RequestFilter,
      sort: p.sort,
      page: p.page,
      pageSize: PAGE_SIZE,
      q: p.q || undefined,
    }),
    requestStatusCounts(db),
  ])

  const ids = page.items.map((r) => r.id)
  const [merges, requesters] = await Promise.all([
    mergedInto(db, ids),
    (async () => {
      const userIds = [...new Set(page.items.map((r) => r.userId).filter((v): v is number => !!v))]
      if (userIds.length === 0) return new Map<number, string>()
      const rows = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(
          userIds.length === 1 ? eq(users.id, userIds[0] as number) : inArray(users.id, userIds),
        )
      return new Map(rows.map((r) => [r.id, r.username ?? '']))
    })(),
  ])

  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        actions={
          <a
            href="/requests"
            className="inline-flex h-9 items-center rounded-md border border-line bg-surface-1 px-3 text-[13px] font-semibold hover:bg-surface-2"
          >
            {m.viewOnSite}
          </a>
        }
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(['open', 'planned', 'added', 'exists', 'declined'] as const).map((status) => (
          <StatTile
            key={status}
            label={messages.requests.statuses[status]}
            value={counts[status]}
            href={`/admin/requests?status=${status}`}
            tone={status === 'open' && counts.open > 0 ? 'warn' : undefined}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-3">
        <RequestsQueue
          status={p.status}
          sort={p.sort}
          q={p.q}
          items={page.items.map((r) => ({
            id: r.id,
            title: r.title,
            altTitles: r.altTitles ?? [],
            link: r.link,
            type: r.type,
            note: r.note,
            status: r.status,
            declineReason: r.declineReason,
            voteCount: Number(r.voteCount),
            createdAt: r.createdAt.toISOString(),
            resolvedAt: r.resolvedAt?.toISOString() ?? null,
            seriesId: r.seriesId,
            seriesTitle: r.seriesTitle,
            seriesSlug: r.seriesSlug,
            requester: r.userId ? (requesters.get(r.userId) ?? m.byAccount) : null,
            mergedIn: merges.get(r.id) ?? [],
          }))}
        />
        <Pagination
          page={page.page}
          pages={page.pages}
          hrefFor={(n) =>
            `/admin/requests?status=${p.status}&sort=${p.sort}&q=${encodeURIComponent(p.q)}&page=${n}`
          }
        />
      </div>
    </>
  )
}
