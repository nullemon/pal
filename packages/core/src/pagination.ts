/**
 * Pagination arithmetic, with no dependencies.
 *
 * It lives here rather than in `@palscans/db` because page components import it directly,
 * and pulling the database package into their module graph for a pure function perturbs
 * client chunking — it duplicated the whole copy catalogue across two chunks, +20 KB
 * gzipped on every route (docs/20).
 */
/**
 * The page a listing actually serves, given how many rows there are: never below 1, never
 * past the last page that holds any. `clampPage` only ever knew the lower bound, which is
 * how `?page=9999` became a real query — `OFFSET 239976`, a full sort, no rows — and, worse
 * than the query, a cache entry of its own for every one of the ten thousand values the
 * parameter accepts. Clamping first makes every out-of-range page the last real page: one
 * answer, one cache key. `/browse` has always done this inline; this is that rule, in one
 * place, for every listing that paginates.
 */
export const pageWindow = (
  page: number | undefined,
  total: number,
  pageSize: number,
): { page: number; totalPages: number } => {
  const size = Math.max(1, Math.floor(pageSize))
  const totalPages = Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / size))
  const asked = Math.floor(Number(page) || 1)
  return { page: Math.min(Math.max(1, asked), totalPages), totalPages }
}
