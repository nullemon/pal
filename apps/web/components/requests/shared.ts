/**
 * The contract between the request board's client islands and its route handlers: the view
 * models that cross the wire, and the helpers both sides format with.
 *
 * Deliberately free of zod. `RequestTrigger` sits in the site header, so every module this
 * file touches is on every page's critical path — and zod is 84 KB gzipped, more than half
 * a page's entire budget (docs/20). The schemas that validate an untrusted body live in
 * `./schemas`, which only route handlers import; nothing in the browser needs them, because
 * the server is the only thing that may believe a request body anyway.
 */

export const REQUEST_STATUSES = ['open', 'planned', 'added', 'declined', 'exists'] as const
export type RequestStatusValue = (typeof REQUEST_STATUSES)[number]

export const REQUEST_FILTERS = [...REQUEST_STATUSES, 'all', 'resolved'] as const
export type RequestFilterValue = (typeof REQUEST_FILTERS)[number]
export const REQUEST_SORTS = ['votes', 'new'] as const
export type RequestSortValue = (typeof REQUEST_SORTS)[number]

/** One row of the board, as the public sees it. No requester identity ever appears here. */
export interface RequestItem {
  id: number
  title: string
  altTitles: string[]
  link: string | null
  type: string | null
  note: string | null
  status: RequestStatusValue
  declineReason: string | null
  voteCount: number
  createdAt: string
  /** Whether the viewer has already voted — decided on the server, never guessed. */
  voted: boolean
  /** Where to read it, once the request has been fulfilled. This is the loop closing. */
  seriesHref: string | null
  seriesTitle: string | null
}

/** A series the catalogue already has, offered before anybody asks for it again. */
export interface SeriesMatch {
  id: number
  title: string
  href: string
  type: string
  coverSrc: string
  chapterCount: number
}

export interface Suggestions {
  q: string
  series: SeriesMatch[]
  requests: RequestItem[]
  /** True when one of `requests` is close enough that submitting would be refused. */
  duplicateId: number | null
}

// --- shared formatting ---------------------------------------------------------------------

export const statusTone = (
  status: RequestStatusValue,
): 'neutral' | 'brand' | 'ok' | 'warn' | 'gold' => {
  switch (status) {
    case 'added':
      return 'ok'
    case 'exists':
      return 'brand'
    case 'planned':
      return 'gold'
    case 'declined':
      return 'neutral'
    default:
      return 'warn'
  }
}

export const isRequestFilter = (v: unknown): v is RequestFilterValue =>
  typeof v === 'string' && (REQUEST_FILTERS as readonly string[]).includes(v)

export const isRequestSort = (v: unknown): v is RequestSortValue =>
  typeof v === 'string' && (REQUEST_SORTS as readonly string[]).includes(v)

export const boardHref = (filter: RequestFilterValue, sort: RequestSortValue, page = 1): string => {
  const params = new URLSearchParams()
  if (filter !== 'open') params.set('status', filter)
  if (sort !== 'votes') params.set('sort', sort)
  if (page > 1) params.set('page', String(page))
  const q = params.toString()
  return q ? `/requests?${q}` : '/requests'
}
