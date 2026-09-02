/**
 * The dry run (docs/17 §E): map everything, count what would be written, and list every
 * chapter display name the parser refused — the review CSV docs/09 asks for. Writes nothing.
 */
import { type DiscoveryReport, discover } from './discover.js'
import {
  type MappedChapter,
  type MappedSeries,
  mapBookmark,
  mapChapter,
  mapComment,
  mapSeries,
  mapUser,
} from './map.js'
import { legacyRedirects, type RedirectOptions } from './redirects.js'
import type { LegacySource } from './source.js'

/** One row of the unparsed-chapter CSV a human reviews. */
export interface UnparsedChapter {
  seriesSlug: string
  seriesTitle: string
  legacyChapterId: number
  name: string
  /** What the parser did recover, if anything, so the reviewer has a starting point. */
  suggestedTitle: string | null
  suggestedVolume: number | null
}

export interface DryRunReport {
  discovery: DiscoveryReport
  totals: {
    series: number
    seriesPublished: number
    seriesSkipped: number
    chapters: number
    chaptersParsed: number
    chaptersUnparsed: number
    chapterPages: number
    genres: number
    people: number
    altTitles: number
    users: number
    bookmarks: number
    bookmarksOrphaned: number
    comments: number
    redirects: number
  }
  byType: Record<string, number>
  byStatus: Record<string, number>
  unparsedChapters: UnparsedChapter[]
  warnings: string[]
}

const bump = (bag: Record<string, number>, key: string): void => {
  bag[key] = (bag[key] ?? 0) + 1
}

export interface DryRunOptions extends RedirectOptions {
  /** Cap the unparsed list held in memory; the count stays exact. */
  maxUnparsed?: number
}

export const dryRun = async (
  source: LegacySource,
  options: DryRunOptions = {},
): Promise<DryRunReport> => {
  const maxUnparsed = options.maxUnparsed ?? 5000
  const discovery = await discover(source)

  const allSeries: MappedSeries[] = []
  const allChapters: MappedChapter[] = []
  const unparsedChapters: UnparsedChapter[] = []
  const warnings: string[] = []
  const genres = new Set<string>()
  const people = new Set<string>()
  const byType: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  const knownSeriesIds = new Set<number>()
  const uniqueIds = new Map<string, number>()

  let chapters = 0
  let chaptersParsed = 0
  let chaptersUnparsed = 0
  let chapterPages = 0
  let altTitles = 0
  let seriesPublished = 0
  let seriesSkipped = 0

  for await (const post of source.listSeries()) {
    const mapped = mapSeries(post)
    if (mapped.deleted) {
      seriesSkipped += 1
      continue
    }
    allSeries.push(mapped)
    knownSeriesIds.add(mapped.legacyId)
    if (mapped.state === 'published') seriesPublished += 1
    bump(byType, mapped.type)
    bump(byStatus, mapped.status)
    altTitles += mapped.altTitles.length
    for (const g of mapped.genres) genres.add(g.slug)
    for (const p of mapped.people) people.add(`${p.credit}:${p.slug}`)
    for (const w of mapped.warnings) warnings.push(`${mapped.slug}: ${w}`)

    const seen = uniqueIds.get(mapped.uniqueId)
    if (seen !== undefined)
      warnings.push(
        `${mapped.slug}: manga_unique_id "${mapped.uniqueId}" is also used by post ${seen} — the second import would overwrite the first.`,
      )
    uniqueIds.set(mapped.uniqueId, mapped.legacyId)

    for await (const raw of source.listChapters(post.id)) {
      const chapter = mapChapter(raw, mapped.uniqueId)
      chapters += 1
      chapterPages += chapter.pages.length
      allChapters.push(chapter)
      if (chapter.number === null) {
        chaptersUnparsed += 1
        if (unparsedChapters.length < maxUnparsed)
          unparsedChapters.push({
            seriesSlug: mapped.slug,
            seriesTitle: mapped.title,
            legacyChapterId: chapter.legacyId,
            name: chapter.rawName,
            suggestedTitle: chapter.title,
            suggestedVolume: chapter.volume,
          })
      } else chaptersParsed += 1
      if (chapter.pages.length === 0)
        warnings.push(`${mapped.slug}: chapter "${chapter.rawName}" has no pages.`)
    }
  }

  let users = 0
  const emails = new Set<string>()
  for await (const raw of source.listUsers()) {
    const user = mapUser(raw)
    users += 1
    if (user.email === '') warnings.push(`legacy user ${user.legacyId} has no email address.`)
    else if (emails.has(user.email))
      warnings.push(`duplicate email "${user.email}" — the later account is skipped.`)
    emails.add(user.email)
  }

  let bookmarks = 0
  let bookmarksOrphaned = 0
  for await (const raw of source.listBookmarks()) {
    const bookmark = mapBookmark(raw)
    bookmarks += 1
    if (bookmark.seriesLegacyId === null || !knownSeriesIds.has(bookmark.seriesLegacyId))
      bookmarksOrphaned += 1
  }

  let comments = 0
  for await (const raw of source.listComments()) {
    const comment = mapComment(raw)
    comments += 1
    if (comment.body.children.length === 0)
      warnings.push(`legacy comment ${comment.legacyId} is empty after HTML conversion.`)
  }

  const redirects = legacyRedirects(allSeries, allChapters, options)
  if (chaptersUnparsed > 0)
    warnings.push(
      `${chaptersUnparsed} chapter names could not be parsed; download the CSV and fix them before the run.`,
    )

  return {
    discovery,
    totals: {
      series: allSeries.length,
      seriesPublished,
      seriesSkipped,
      chapters,
      chaptersParsed,
      chaptersUnparsed,
      chapterPages,
      genres: genres.size,
      people: people.size,
      altTitles,
      users,
      bookmarks,
      bookmarksOrphaned,
      comments,
      redirects: redirects.length,
    },
    byType,
    byStatus,
    unparsedChapters,
    warnings,
  }
}

const CSV_HEADER = [
  'series_slug',
  'series_title',
  'legacy_chapter_id',
  'chapter_name',
  'suggested_title',
  'suggested_volume',
  'number',
] as const

const cell = (value: string | number | null): string => {
  const s = value === null ? '' : String(value)
  return /["',\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The review CSV docs/09 asks for; the empty `number` column is what the human fills in. */
export const unparsedChaptersCsv = (rows: readonly UnparsedChapter[]): string =>
  [
    CSV_HEADER.join(','),
    ...rows.map((r) =>
      [
        cell(r.seriesSlug),
        cell(r.seriesTitle),
        cell(r.legacyChapterId),
        cell(r.name),
        cell(r.suggestedTitle),
        cell(r.suggestedVolume),
        '',
      ].join(','),
    ),
  ].join('\n')
