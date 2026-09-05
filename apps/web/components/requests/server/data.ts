import {
  getDb,
  listRequests,
  REQUEST_DUPLICATE_THRESHOLD,
  type RequestRow,
  searchRequests,
  votedRequestIds,
} from '@palscans/db'
import { search } from '@/components/discovery/queries'
import type {
  RequestFilterValue,
  RequestItem,
  RequestSortValue,
  RequestStatusValue,
  SeriesMatch,
  Suggestions,
} from '../shared'
import type { RequestActor } from './identity'

/**
 * Reads for the board and the modal. Two rules live here and nowhere else:
 *
 *   * a row leaves this module as a `RequestItem` — the requester's account id and hashed
 *     key are dropped on the way out, so no public surface can leak them by accident;
 *   * "already on the site" is answered by `search()` → `searchSeries`, the one series
 *     search this codebase has. A large share of requests are for titles the site already
 *     carries, and the cheapest fix for that is to show them before the form is submitted.
 */

const toItem = (row: RequestRow, voted: boolean): RequestItem => ({
  id: row.id,
  title: row.title,
  altTitles: row.altTitles ?? [],
  link: row.link,
  type: row.type,
  note: row.note,
  status: row.status as RequestStatusValue,
  declineReason: row.declineReason,
  voteCount: Number(row.voteCount),
  createdAt: row.createdAt.toISOString(),
  voted,
  seriesHref: row.seriesSlug ? `/series/${row.seriesSlug}` : null,
  seriesTitle: row.seriesTitle,
})

export interface BoardOptions {
  filter: RequestFilterValue
  sort: RequestSortValue
  page: number
  actor: RequestActor
}

export interface Board {
  items: RequestItem[]
  total: number
  page: number
  pages: number
}

export const loadBoard = async (opts: BoardOptions): Promise<Board> => {
  const db = await getDb()
  const page = await listRequests(db, {
    filter: opts.filter,
    sort: opts.sort,
    page: opts.page,
  })
  const voted = await votedRequestIds(
    db,
    page.items.map((r) => r.id),
    opts.actor,
  )
  return {
    items: page.items.map((r) => toItem(r, voted.has(r.id))),
    total: page.total,
    page: page.page,
    pages: page.pages,
  }
}

/**
 * Search-before-you-post: what the site already has, and what has already been asked for.
 * Both halves in one round trip, because the reader is typing and every keystroke that costs
 * two requests costs twice as much.
 */
export const loadSuggestions = async (q: string, actor: RequestActor): Promise<Suggestions> => {
  const query = q.trim().replace(/\s+/g, ' ')
  if (query.length < 2) return { q: query, series: [], requests: [], duplicateId: null }
  const db = await getDb()
  const [catalogue, requests] = await Promise.all([
    search(query, 5).catch(() => []),
    searchRequests(db, query, 6),
  ])
  const voted = await votedRequestIds(
    db,
    requests.map((r) => r.id),
    actor,
  )
  const top = requests[0]
  return {
    q: query,
    series: catalogue.map(
      (s): SeriesMatch => ({
        id: s.id,
        title: s.title,
        href: s.href,
        type: s.type,
        coverSrc: s.coverSrc,
        chapterCount: s.chapterCount,
      }),
    ),
    requests: requests.map((r) => toItem(r, voted.has(r.id))),
    duplicateId: top && top.score >= REQUEST_DUPLICATE_THRESHOLD ? top.id : null,
  }
}

export const toRequestItem = toItem
