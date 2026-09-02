/**
 * Discovery (docs/17 §E): report what the legacy database actually holds *before* anything
 * is written. Counts per post type, taxonomy and meta key against the docs/09 mapping, plus
 * whether chapters live in the plugin's custom tables or in postmeta.
 *
 * This function writes nothing, anywhere.
 */
import { META_KEYS, SERIES_POST_TYPE, TAXONOMIES } from './map.js'
import type { ChapterStorage, LegacySource } from './source.js'

export interface DiscoveryReport {
  source: string
  generatedAt: string
  chapterStorage: ChapterStorage
  /** `post_type` → row count, for the types the importer reads. */
  postTypes: Record<string, number>
  /** taxonomy → distinct terms and how many series use them. */
  taxonomies: Record<string, { terms: number; usages: number; mapped: boolean }>
  /** meta key → how many series carry it, for every key docs/09 pins. */
  metaKeys: Record<string, { present: number; mapped: boolean }>
  counts: {
    series: number
    chapters: number
    chapterPages: number
    terms: number
    users: number
    bookmarks: number
    comments: number
  }
  /** Raw `_wp_manga_type` / `_wp_manga_status` values as found, so surprises are visible. */
  seriesTypes: Record<string, number>
  seriesStatuses: Record<string, number>
  seriesStates: Record<string, number>
  /** Series with no `manga_unique_id`; the importer keys those on the post id. */
  missingUniqueId: number
  warnings: string[]
}

const bump = (bag: Record<string, number>, key: string, by = 1): void => {
  bag[key] = (bag[key] ?? 0) + by
}

export const discover = async (source: LegacySource): Promise<DiscoveryReport> => {
  const postTypes: Record<string, number> = {}
  const taxonomyUsages: Record<string, number> = {}
  const taxonomyTerms: Record<string, number> = {}
  const metaPresent: Record<string, number> = {}
  const seriesTypes: Record<string, number> = {}
  const seriesStatuses: Record<string, number> = {}
  const seriesStates: Record<string, number> = {}
  const warnings: string[] = []

  let seriesCount = 0
  let chapterCount = 0
  let pageCount = 0
  let missingUniqueId = 0

  for await (const post of source.listSeries()) {
    seriesCount += 1
    bump(postTypes, post.type || SERIES_POST_TYPE)
    bump(seriesStates, post.status)
    bump(seriesTypes, (post.meta._wp_manga_type ?? '(none)').trim() || '(none)')
    bump(seriesStatuses, (post.meta._wp_manga_status ?? '(none)').trim() || '(none)')
    if (!(post.meta.manga_unique_id ?? '').trim()) missingUniqueId += 1
    for (const key of Object.keys(post.meta)) {
      if (post.meta[key] !== undefined && post.meta[key] !== '') bump(metaPresent, key)
    }
    for (const term of post.terms) bump(taxonomyUsages, term.taxonomy)
    for await (const chapter of source.listChapters(post.id)) {
      chapterCount += 1
      pageCount += chapter.pages.length
    }
  }

  let termCount = 0
  for await (const term of source.listTerms()) {
    termCount += 1
    bump(taxonomyTerms, term.taxonomy)
  }

  let users = 0
  for await (const _user of source.listUsers()) users += 1
  let bookmarks = 0
  for await (const post of source.listBookmarks()) {
    bookmarks += 1
    bump(postTypes, post.type)
  }
  let comments = 0
  for await (const _comment of source.listComments()) comments += 1

  const chapterStorage = await source.chapterStorage()
  if (chapterStorage === 'postmeta')
    warnings.push(
      'Chapters are in wp_postmeta, not the plugin custom tables — expect a slower read and confirm the page order meta key before importing.',
    )
  if (chapterStorage === 'unknown')
    warnings.push(
      'Could not determine where chapters are stored; run the docs/09 discovery SQL by hand.',
    )
  if (missingUniqueId > 0)
    warnings.push(
      `${missingUniqueId} series have no manga_unique_id; those rows are keyed on their post id, so a re-import after a slug change may duplicate them.`,
    )

  const taxonomies: DiscoveryReport['taxonomies'] = {}
  for (const tax of new Set([...Object.keys(taxonomyTerms), ...Object.keys(taxonomyUsages)])) {
    taxonomies[tax] = {
      terms: taxonomyTerms[tax] ?? 0,
      usages: taxonomyUsages[tax] ?? 0,
      mapped: tax in TAXONOMIES,
    }
  }
  const metaKeys: DiscoveryReport['metaKeys'] = {}
  for (const key of new Set([...META_KEYS, ...Object.keys(metaPresent)])) {
    metaKeys[key] = {
      present: metaPresent[key] ?? 0,
      mapped: (META_KEYS as readonly string[]).includes(key),
    }
  }
  for (const key of META_KEYS) {
    if ((metaPresent[key] ?? 0) === 0 && key !== '_bookmark_data' && key !== '_bookmark_time')
      warnings.push(`No series carries "${key}" — the mapped field will fall back to its default.`)
  }

  return {
    source: source.name,
    generatedAt: new Date().toISOString(),
    chapterStorage,
    postTypes,
    taxonomies,
    metaKeys,
    counts: {
      series: seriesCount,
      chapters: chapterCount,
      chapterPages: pageCount,
      terms: termCount,
      users,
      bookmarks,
      comments,
    },
    seriesTypes,
    seriesStatuses,
    seriesStates,
    missingUniqueId,
    warnings,
  }
}
