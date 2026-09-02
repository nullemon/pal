import { z } from 'zod'

/**
 * Browse filters (docs/13 "Catalog and discovery"): type, status, genres to include AND
 * exclude, minimum chapters, minimum rating, sort. Every parameter is validated with zod and
 * lives in the URL so results are shareable and crawlable.
 */
export const SERIES_TYPES = ['manhwa', 'manga', 'manhua', 'comic', 'novel'] as const
export const SERIES_STATUSES = ['ongoing', 'completed', 'hiatus', 'cancelled', 'dropped'] as const
export const BROWSE_SORTS = ['latest', 'popular', 'rating', 'newest', 'title'] as const
export const MIN_CHAPTER_OPTIONS = [0, 10, 25, 50, 100, 200] as const
export const MIN_RATING_OPTIONS = [0, 6, 7, 8, 9] as const
export const BROWSE_PAGE_SIZE = 24

export type SeriesTypeValue = (typeof SERIES_TYPES)[number]
export type SeriesStatusValue = (typeof SERIES_STATUSES)[number]
export type BrowseSort = (typeof BROWSE_SORTS)[number]

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{1,80}$/)

const slugList = z.preprocess(
  (v) => (Array.isArray(v) ? v : v === undefined || v === '' ? [] : [v]),
  z.array(slug.catch('')).transform((list) => [...new Set(list.filter(Boolean))].slice(0, 12)),
)

export const browseParamsSchema = z.object({
  type: z.enum(SERIES_TYPES).optional().catch(undefined),
  status: z.enum(SERIES_STATUSES).optional().catch(undefined),
  genre: slugList.catch([]),
  exclude: slugList.catch([]),
  minChapters: z.coerce.number().int().min(0).max(10_000).catch(0),
  minRating: z.coerce.number().min(0).max(10).catch(0),
  sort: z.enum(BROWSE_SORTS).catch('latest'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
})

export type BrowseParams = z.infer<typeof browseParamsSchema>

export type SearchParamsInput = Record<string, string | string[] | undefined>

export const parseBrowseParams = (input: SearchParamsInput): BrowseParams =>
  browseParamsSchema.parse(input)

export const DEFAULT_BROWSE: BrowseParams = {
  type: undefined,
  status: undefined,
  genre: [],
  exclude: [],
  minChapters: 0,
  minRating: 0,
  sort: 'latest',
  page: 1,
}

/** True when anything but the defaults is set (the page then carries `noindex`, docs/12 §7). */
export const isFiltered = (p: BrowseParams): boolean =>
  p.type !== undefined ||
  p.status !== undefined ||
  p.genre.length > 0 ||
  p.exclude.length > 0 ||
  p.minChapters > 0 ||
  p.minRating > 0 ||
  p.sort !== 'latest' ||
  p.page > 1

/** Build a `/browse` URL, omitting defaults so the canonical form stays clean. */
export function browseHref(params: Partial<BrowseParams>, base = '/browse'): string {
  const p = { ...DEFAULT_BROWSE, ...params }
  const qs = new URLSearchParams()
  if (p.type) qs.set('type', p.type)
  if (p.status) qs.set('status', p.status)
  for (const g of p.genre) qs.append('genre', g)
  for (const g of p.exclude) qs.append('exclude', g)
  if (p.minChapters > 0) qs.set('minChapters', String(p.minChapters))
  if (p.minRating > 0) qs.set('minRating', String(p.minRating))
  if (p.sort !== 'latest') qs.set('sort', p.sort)
  if (p.page > 1) qs.set('page', String(p.page))
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

/** Home feed parameters: `?page=` and the type tabs (All · Manhwa · Manga · Manhua). */
export const homeParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  type: z.enum(SERIES_TYPES).optional().catch(undefined),
})
export type HomeParams = z.infer<typeof homeParamsSchema>

export function homeHref(params: Partial<HomeParams>): string {
  const qs = new URLSearchParams()
  if (params.type) qs.set('type', params.type)
  if (params.page && params.page > 1) qs.set('page', String(params.page))
  const s = qs.toString()
  return s ? `/?${s}` : '/'
}

/** Genre landing pages paginate and sort with the same vocabulary as browse. */
export const genrePageParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  sort: z.enum(BROWSE_SORTS).catch('latest'),
})

export const searchParamsSchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .catch('')
    .transform((s) => s.replace(/\s+/g, ' ')),
})

export const slugSchema = slug
