import { z } from 'zod'
import { SERIES_TYPES } from '@/components/discovery/filters'

/**
 * The contract between the request board's client islands and its route handlers: the view
 * models that cross the wire and the zod schemas the server validates with. Client-safe —
 * nothing here imports the database, so `RequestBoard` and `RequestModal` can use the same
 * types the API answers with.
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

// --- request bodies -----------------------------------------------------------------------

const trimmed = z.string().trim()

/**
 * Alternative titles arrive as one textarea. Splitting server-side (rather than asking the
 * client for an array) means the cap is enforced where it matters.
 */
const altTitles = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) =>
    (typeof v === 'string' ? v.split(/\r?\n/) : (v ?? []))
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((s) => s.slice(0, 200)),
  )

export const createRequestSchema = z.object({
  title: trimmed.min(2).max(200),
  altTitles,
  /** `http(s)` only, and only as a pointer for staff — it is never rendered as a link
   *  the site vouches for. */
  link: z
    .union([z.literal(''), z.string().trim().url().max(500)])
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\//i.test(v), 'link must be http(s)'),
  type: z
    .union([z.literal(''), z.enum(SERIES_TYPES)])
    .optional()
    .transform((v) => (v ? v : null)),
  note: z
    .union([z.literal(''), trimmed.max(1000)])
    .optional()
    .transform((v) => (v ? v : null)),
  /** Cloudflare Turnstile token; required for anonymous submissions when configured. */
  turnstile: z.string().max(4096).optional(),
  /** Honeypot — a real browser leaves it empty. */
  website: z.string().max(0).optional(),
})

export type CreateRequestBody = z.input<typeof createRequestSchema>

export const suggestQuerySchema = z.object({
  q: trimmed.min(1).max(200),
})

export const voteSchema = z.object({
  /** false withdraws the vote. */
  vote: z.boolean().default(true),
})

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
