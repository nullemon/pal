/**
 * Legacy → new URL rows for the existing `redirects` table (docs/09 "URL preservation").
 * A row per URL generated from the source data, never a regex guess.
 *
 * `/manga/<slug>/`                 → `/series/<slug>`
 * `/manga/<slug>/chapter-<n>/`     → `/series/<slug>/chapter-<n>`
 * `/manga-genre/<slug>/`           → `/genres/<slug>`
 *
 * Note on the chapter target: docs/09 writes it as `/series/<slug>/<n>`; the built reader
 * route is `/series/<slug>/chapter-<n>` (see components/series/ChapterTable), so that is the
 * default here — a 301 into a 404 would be worse than the doc's shorthand. Override with
 * `chapterPath` if the route ever changes.
 */
import type { MappedChapter, MappedSeries } from './map.js'

export interface RedirectRow {
  fromPath: string
  toPath: string
  status: 301
}

export interface RedirectOptions {
  /** Legacy series base, default `manga` (the theme's `manga_archive_slug`). */
  seriesBase?: string
  /** Legacy genre base, default `manga-genre`. */
  genreBase?: string
  /** New chapter path builder. */
  chapterPath?: (seriesSlug: string, number: string) => string
}

const trimNumber = (n: string): string => n

/** Build the redirect rows for a mapped catalogue. Deduplicated and sorted by `fromPath`. */
export const legacyRedirects = (
  series: readonly MappedSeries[],
  chapters: readonly MappedChapter[] = [],
  options: RedirectOptions = {},
): RedirectRow[] => {
  const seriesBase = options.seriesBase ?? 'manga'
  const genreBase = options.genreBase ?? 'manga-genre'
  const chapterPath = options.chapterPath ?? ((slug, n) => `/series/${slug}/chapter-${n}`)

  const rows = new Map<string, RedirectRow>()
  const add = (fromPath: string, toPath: string): void => {
    if (!rows.has(fromPath)) rows.set(fromPath, { fromPath, toPath, status: 301 })
  }

  const bySlug = new Map<number, string>()
  const genres = new Map<string, string>()
  for (const s of series) {
    if (s.deleted || s.slug === '') continue
    bySlug.set(s.legacyId, s.slug)
    add(`/${seriesBase}/${s.slug}/`, `/series/${s.slug}`)
    for (const g of s.genres) {
      if (g.role === 'genre') genres.set(g.slug, `/genres/${g.slug}`)
    }
  }
  for (const [slug, to] of genres) add(`/${genreBase}/${slug}/`, to)

  for (const c of chapters) {
    const slug = bySlug.get(c.seriesLegacyId)
    if (slug === undefined || c.number === null) continue
    const to = chapterPath(slug, trimNumber(c.number))
    add(`/${seriesBase}/${slug}/chapter-${c.number}/`, to)
    if (c.legacySlug && c.legacySlug !== `chapter-${c.number}`)
      add(`/${seriesBase}/${slug}/${c.legacySlug}/`, to)
  }

  return [...rows.values()].sort((a, b) => a.fromPath.localeCompare(b.fromPath))
}
