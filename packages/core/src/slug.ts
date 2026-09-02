/**
 * Slugs: lowercase, hyphenated ASCII generated from the title (docs/12-seo.md §1).
 * Non-Latin titles that produce nothing fall back to the provided fallback.
 */
const DIACRITICS = /[̀-ͯ]/g
const NON_ALNUM = /[^a-z0-9]+/g
const EDGE_HYPHENS = /^-+|-+$/g

export const MAX_SLUG_LENGTH = 80

export interface SlugOptions {
  maxLength?: number
  fallback?: string
}

export const slugify = (input: string, opts: SlugOptions = {}): string => {
  const max = opts.maxLength ?? MAX_SLUG_LENGTH
  let s = input
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .replace(/[''`]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(NON_ALNUM, '-')
    .replace(EDGE_HYPHENS, '')
  if (s.length > max) s = s.slice(0, max).replace(EDGE_HYPHENS, '')
  if (!s) return opts.fallback ?? 'untitled'
  return s
}

export const isValidSlug = (s: string): boolean =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= MAX_SLUG_LENGTH

/**
 * Collision suffixes: `foo`, `foo-2`, `foo-3` … (never `foo-1`).
 * `taken` is the set of slugs already in use (case-insensitive is the caller's job:
 * the column is citext, so pass lower-cased values).
 */
export const uniqueSlug = (base: string, taken: Iterable<string>): string => {
  const set = new Set(Array.from(taken, (t) => t.toLowerCase()))
  const root = slugify(base)
  if (!set.has(root)) return root
  for (let n = 2; ; n++) {
    const candidate = withSuffix(root, n)
    if (!set.has(candidate)) return candidate
  }
}

/** Append `-n`, trimming the root so the result stays within MAX_SLUG_LENGTH. */
export const withSuffix = (root: string, n: number): string => {
  const suffix = `-${n}`
  const room = MAX_SLUG_LENGTH - suffix.length
  const trimmed = root.length > room ? root.slice(0, room).replace(EDGE_HYPHENS, '') : root
  return `${trimmed}${suffix}`
}

/** Given a slug like `foo-3`, returns { root: 'foo', n: 3 }; `foo` → { root: 'foo', n: 1 }. */
export const parseSuffix = (slug: string): { root: string; n: number } => {
  const m = /^(.*?)-(\d+)$/.exec(slug)
  if (!m?.[1] || !m[2]) return { root: slug, n: 1 }
  const n = Number.parseInt(m[2], 10)
  return n >= 2 ? { root: m[1], n } : { root: slug, n: 1 }
}
