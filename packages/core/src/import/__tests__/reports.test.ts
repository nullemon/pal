import { describe, expect, it } from 'vitest'
import { createFixtureSource, legacySeries } from '../__fixtures__/index.js'
import {
  defaultImportSetting,
  describeImportSource,
  importSourceReady,
  maskDsn,
  maskImportSetting,
  mergeDsn,
} from '../config.js'
import { discover } from '../discover.js'
import { dryRun, unparsedChaptersCsv } from '../dry-run.js'
import { mapChapter, mapSeries } from '../map.js'
import { legacyRedirects } from '../redirects.js'

describe('legacyRedirects', () => {
  const series = legacySeries.map(mapSeries)
  const chapters = [
    mapChapter({
      chapterId: 1,
      seriesPostId: 101,
      name: 'Chapter 12.5',
      slug: 'chapter-12-5',
      pages: [],
    }),
    mapChapter({ chapterId: 2, seriesPostId: 101, name: 'Prologue', slug: 'prologue', pages: [] }),
    mapChapter({
      chapterId: 3,
      seriesPostId: 104,
      name: 'Chapter 1',
      slug: 'chapter-1',
      pages: [],
    }),
  ]
  const rows = legacyRedirects(series, chapters)
  const from = (path: string) => rows.find((r) => r.fromPath === path)

  it('maps series, chapter and genre URLs', () => {
    expect(from('/manga/ashfall-requiem/')).toEqual({
      fromPath: '/manga/ashfall-requiem/',
      toPath: '/series/ashfall-requiem',
      status: 301,
    })
    expect(from('/manga/ashfall-requiem/chapter-12.5/')?.toPath).toBe(
      '/series/ashfall-requiem/chapter-12.5',
    )
    // The theme's own chapter slug redirects to the same place.
    expect(from('/manga/ashfall-requiem/chapter-12-5/')?.toPath).toBe(
      '/series/ashfall-requiem/chapter-12.5',
    )
    expect(from('/manga-genre/action/')?.toPath).toBe('/genres/action')
    expect(from('/manga-genre/fantasy/')?.toPath).toBe('/genres/fantasy')
  })

  it('skips trashed series and unparsed chapters, and emits a genre row once', () => {
    expect(from('/manga/deleted-draft-series/')).toBeUndefined()
    expect(rows.some((r) => r.fromPath.includes('prologue'))).toBe(false)
    expect(rows.filter((r) => r.fromPath === '/manga-genre/action/')).toHaveLength(1)
    // Tags are not genre pages on the legacy site's /manga-genre/ base.
    expect(from('/manga-genre/female-lead/')).toBeUndefined()
  })

  it('honours the archive bases and a custom chapter path', () => {
    const custom = legacyRedirects(series, chapters, {
      seriesBase: 'series-old',
      genreBase: 'genre',
      chapterPath: (slug, n) => `/series/${slug}/${n}`,
    })
    expect(custom.some((r) => r.fromPath === '/series-old/ashfall-requiem/')).toBe(true)
    expect(
      custom.find((r) => r.fromPath === '/series-old/ashfall-requiem/chapter-12.5/')?.toPath,
    ).toBe('/series/ashfall-requiem/12.5')
    expect(custom.some((r) => r.fromPath === '/genre/action/')).toBe(true)
  })

  it('returns rows sorted and deduplicated', () => {
    const paths = rows.map((r) => r.fromPath)
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)))
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('discover', () => {
  it('counts post types, taxonomies and meta keys without writing', async () => {
    const report = await discover(createFixtureSource())
    expect(report.chapterStorage).toBe('custom-tables')
    expect(report.counts).toMatchObject({
      series: 5,
      chapters: 10,
      chapterPages: 193,
      users: 4,
      bookmarks: 3,
      comments: 4,
      terms: 12,
    })
    expect(report.postTypes['wp-manga']).toBe(5)
    expect(report.postTypes['manga-bookmark']).toBe(3)
    expect(report.taxonomies['wp-manga-genre']).toEqual({ terms: 3, usages: 6, mapped: true })
    expect(report.taxonomies.category).toEqual({ terms: 1, usages: 0, mapped: false })
    expect(report.metaKeys.manga_unique_id).toEqual({ present: 4, mapped: true })
    expect(report.metaKeys._manga_avarage_reviews?.present).toBe(4)
    expect(report.missingUniqueId).toBe(1)
    expect(report.seriesTypes).toMatchObject({ manhwa: 1, manga: 1, manhua: 1, webtoon: 1 })
    expect(report.seriesStatuses['weird-status']).toBe(1)
    expect(report.warnings.some((w) => w.includes('manga_unique_id'))).toBe(true)
  })

  it('warns when chapters are not in the plugin custom tables', async () => {
    const report = await discover(createFixtureSource({ chapterStorage: 'postmeta' }))
    expect(report.warnings.some((w) => w.includes('wp_postmeta'))).toBe(true)
  })
})

describe('dryRun', () => {
  it('reports the mapping and lists every unparseable chapter name', async () => {
    const report = await dryRun(createFixtureSource())
    expect(report.totals).toMatchObject({
      series: 4,
      seriesPublished: 3,
      seriesSkipped: 1,
      chapters: 10,
      chaptersParsed: 7,
      chaptersUnparsed: 3,
      users: 4,
      bookmarks: 3,
      bookmarksOrphaned: 1,
      comments: 4,
    })
    expect(report.byType).toEqual({ manhwa: 2, manga: 1, manhua: 1 })
    expect(report.byStatus).toMatchObject({ ongoing: 2, completed: 1, hiatus: 1 })
    expect(report.unparsedChapters.map((c) => c.name).sort()).toEqual([
      'Chapter 1-2',
      'Prologue',
      'Season 2 Finale',
    ])
    const prologue = report.unparsedChapters.find((c) => c.name === 'Prologue')
    expect(prologue).toMatchObject({ seriesSlug: 'ashfall-requiem', legacyChapterId: 5004 })
    expect(report.totals.redirects).toBeGreaterThan(0)
    expect(report.warnings.some((w) => w.includes('3 chapter names'))).toBe(true)
    expect(report.warnings.some((w) => w.includes('has no pages'))).toBe(true)
  })

  it('caps the unparsed list without changing the count', async () => {
    const report = await dryRun(createFixtureSource(), { maxUnparsed: 1 })
    expect(report.unparsedChapters).toHaveLength(1)
    expect(report.totals.chaptersUnparsed).toBe(3)
  })

  it('renders the review CSV', async () => {
    const report = await dryRun(createFixtureSource())
    const csv = unparsedChaptersCsv(report.unparsedChapters)
    const lines = csv.split('\n')
    expect(lines[0]).toBe(
      'series_slug,series_title,legacy_chapter_id,chapter_name,suggested_title,suggested_volume,number',
    )
    expect(lines).toHaveLength(4)
    expect(csv).toContain('ashfall-requiem,Ashfall Requiem,5004,Prologue,Prologue,,')
  })

  it('escapes commas and quotes in the CSV', () => {
    const csv = unparsedChaptersCsv([
      {
        seriesSlug: 'a',
        seriesTitle: 'Title, with comma',
        legacyChapterId: 1,
        name: 'He said "hi"',
        suggestedTitle: null,
        suggestedVolume: null,
      },
    ])
    expect(csv.split('\n')[1]).toBe('a,"Title, with comma",1,"He said ""hi""",,,')
  })
})

describe('import settings', () => {
  it('defaults to the sample source and validates the prefix', () => {
    const setting = defaultImportSetting()
    expect(setting.mode).toBe('sample')
    expect(setting.tablePrefix).toBe('wp_')
    expect(importSourceReady(setting)).toBe(true)
    expect(importSourceReady({ ...setting, mode: 'dump' })).toBe(false)
    expect(importSourceReady({ ...setting, mode: 'dsn', dsn: 'mysql://u:p@h/db' })).toBe(true)
  })

  it('masks the DSN password whenever it is read back', () => {
    expect(maskDsn('mysql://wp:s3cret@10.0.0.4:3306/wordpress')).toBe(
      'mysql://wp:••••••••@10.0.0.4:3306/wordpress',
    )
    expect(maskDsn('mysql://wp@10.0.0.4/wordpress')).toBe('mysql://wp@10.0.0.4/wordpress')
    expect(maskDsn('')).toBe('')
    const setting = { ...defaultImportSetting(), dsn: 'mysql://wp:s3cret@db/wordpress' }
    expect(maskImportSetting(setting).dsn).not.toContain('s3cret')
    expect(describeImportSource({ ...setting, mode: 'dsn' })).not.toContain('s3cret')
  })

  it('keeps the stored password when the operator saves the masked value back', () => {
    const stored = 'mysql://wp:s3cret@db/wordpress'
    expect(mergeDsn(maskDsn(stored), stored)).toBe(stored)
    expect(mergeDsn('mysql://wp:new@db/wordpress', stored)).toBe('mysql://wp:new@db/wordpress')
  })
})
