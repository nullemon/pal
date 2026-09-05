/**
 * The catalogue's vocabulary — the lists a picker renders and a URL is validated against.
 *
 * Its own file, with no imports at all, because `filters.ts` validates with zod and the
 * series-type list is needed by islands on the critical path (the request modal lives in the
 * site header, so it is on every page). Importing one constant out of a zod module costs
 * 84 KB gzipped in the browser; importing it from here costs nothing. `filters.ts`
 * re-exports everything below, so nothing that already imports from there has to change.
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
