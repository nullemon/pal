import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { cn } from '@palscans/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { RequestBoard } from '@/components/requests/RequestBoard'
import { RequestTrigger } from '@/components/requests/RequestTrigger'
import { loadBoard } from '@/components/requests/server/data'
import { readActor } from '@/components/requests/server/identity'
import {
  boardHref,
  isRequestFilter,
  isRequestSort,
  REQUEST_SORTS,
  type RequestFilterValue,
} from '@/components/requests/shared'
import { buildMetadata } from '@/lib/seo/metadata'

/**
 * `/requests` — the full board. The modal in the header is how a request is *filed*; this is
 * where the answer lives: every request, its status, and — once it has been fulfilled — a
 * link to the series. That last part is what makes the board worth coming back to rather
 * than a suggestion box that swallows things.
 *
 * Rendered per request, never cached: each row carries "have *you* voted for this", which is
 * derived from the viewer's own identity.
 */
export const dynamic = 'force-dynamic'

export function generateMetadata(): Promise<Metadata> {
  return buildMetadata('page', {
    path: '/requests',
    override: { title: messages.requests.title, description: messages.requests.lead },
  })
}

const m = messages.requests

/** The tabs. "Answered" collects the three outcomes so a reader can see the board works. */
const FILTERS: readonly RequestFilterValue[] = ['open', 'planned', 'added', 'resolved', 'all']

export default async function RequestsPage({ searchParams }: PageProps<'/requests'>) {
  const params = await searchParams
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const filter = isRequestFilter(first(params.status))
    ? (first(params.status) as RequestFilterValue)
    : 'open'
  const sort = isRequestSort(first(params.sort)) ? (first(params.sort) as 'votes' | 'new') : 'votes'
  const pageNumber = Math.min(1000, Math.max(1, Number(first(params.page) ?? '1') || 1))

  const board = await loadBoard({ filter, sort, page: pageNumber, actor: await readActor() })

  const tab =
    'inline-flex h-8 items-center rounded-md px-3 text-[13px] font-semibold transition-colors'

  return (
    <div className="container-page flex flex-col gap-5 pt-6 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5">
        <div className="max-w-[62ch]">
          <h1 className="section-title text-[26px] leading-8">{m.title}</h1>
          <p className="mt-1 text-[14px] leading-6 text-fg-muted">{m.lead}</p>
        </div>
        <RequestTrigger />
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={m.filterLabel} className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={boardHref(f, sort)}
              aria-current={f === filter ? 'page' : undefined}
              className={cn(
                tab,
                f === filter
                  ? 'bg-surface-2 text-fg'
                  : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              {m.statuses[f]}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          {REQUEST_SORTS.map((s) => (
            <Link
              key={s}
              href={boardHref(filter, s)}
              aria-current={s === sort ? 'true' : undefined}
              className={cn(
                tab,
                s === sort
                  ? 'bg-surface-2 text-fg'
                  : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              {s === 'votes' ? m.sortVotes : m.sortNew}
            </Link>
          ))}
        </div>
      </div>

      {filter !== 'all' && filter !== 'resolved' ? (
        <p className="text-[12.5px] text-fg-subtle">{m.statusHints[filter]}</p>
      ) : null}

      <RequestBoard items={board.items} filter={filter} />

      {board.pages > 1 ? (
        <nav className="flex items-center justify-between text-[13px] text-fg-muted">
          <span>
            {fmt(adminMessages.admin.page, {
              page: String(board.page),
              pages: String(board.pages),
            })}
          </span>
          <div className="flex gap-2">
            {board.page > 1 ? (
              <Link
                href={boardHref(filter, sort, board.page - 1)}
                className="inline-flex h-8 items-center rounded-md border border-line px-3 hover:bg-surface-2"
              >
                {adminMessages.admin.previousPage}
              </Link>
            ) : null}
            {board.page < board.pages ? (
              <Link
                href={boardHref(filter, sort, board.page + 1)}
                className="inline-flex h-8 items-center rounded-md border border-line px-3 hover:bg-surface-2"
              >
                {adminMessages.admin.nextPage}
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  )
}
