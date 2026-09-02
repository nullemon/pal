import { describe, expect, it } from 'vitest'
import { createFixtureSource, legacyChapters, legacySeries } from '../__fixtures__/index.js'
import { LEGACY_DUMP_DATA_PREFIX, legacyDumpSql } from '../__fixtures__/legacy-dump.js'
import { discover } from '../discover.js'
import {
  collect,
  type LegacyChapter,
  type LegacyPage,
  type LegacyPost,
  type LegacySource,
} from '../source.js'
import { createDumpSource, type DumpSourceOptions } from '../sources/dump.js'
import {
  bytesDumpReader,
  LegacyPageUnavailableError,
  memoryUploadsReader,
  stringDumpReader,
} from '../sources/types.js'

type SourceOverrides = Partial<Omit<DumpSourceOptions, 'reader'>> & { chunkSize?: number }

const dumpSource = (sql: string, overrides: SourceOverrides = {}) => {
  const { chunkSize, ...rest } = overrides
  return createDumpSource({
    reader: stringDumpReader(sql, { name: 'wordpress.sql', ...(chunkSize ? { chunkSize } : {}) }),
    dataPathPrefix: LEGACY_DUMP_DATA_PREFIX,
    uploads: null,
    ...rest,
  })
}

/** The fixture objects omit optional keys the dump always carries; line them up. */
const normalisePost = (post: LegacyPost) => ({
  ...post,
  parent: post.parent ?? 0,
  modifiedGmt: post.modifiedGmt ?? null,
})

const normalisePage = (page: LegacyPage) => ({
  idx: page.idx,
  path: page.path,
  attachmentId: page.attachmentId ?? null,
})

const normaliseChapter = (chapter: LegacyChapter) => ({
  ...chapter,
  slug: chapter.slug ?? null,
  volumeName: chapter.volumeName ?? null,
  createdAt: chapter.createdAt ?? null,
  pages: chapter.pages.map(normalisePage),
})

/** Everything a LegacySource can be asked for, as one comparable value. */
const snapshot = async (source: LegacySource) => {
  const series = await collect(source.listSeries())
  const chapters: Record<number, ReturnType<typeof normaliseChapter>[]> = {}
  for (const post of series) {
    chapters[post.id] = (await collect(source.listChapters(post.id))).map(normaliseChapter)
  }
  return {
    series: series.map(normalisePost),
    chapters,
    terms: await collect(source.listTerms()),
    users: await collect(source.listUsers()),
    bookmarks: (await collect(source.listBookmarks())).map(normalisePost),
    comments: await collect(source.listComments()),
    chapterStorage: await source.chapterStorage(),
  }
}

describe('the mysqldump adapter against the in-memory fixture', () => {
  it('produces the same LegacySource output as the fixture adapter', async () => {
    const fromDump = await snapshot(dumpSource(legacyDumpSql()))
    const fromFixture = await snapshot(createFixtureSource())
    expect(fromDump).toEqual(fromFixture)
  })

  it('produces the same discovery report as the fixture adapter', async () => {
    const fromDump = await discover(dumpSource(legacyDumpSql()))
    const fromFixture = await discover(createFixtureSource())
    const { source: _a, generatedAt: _b, ...dumpReport } = fromDump
    const { source: _c, generatedAt: _d, ...fixtureReport } = fromFixture
    expect(dumpReport).toEqual(fixtureReport)
    expect(fromDump.counts.series).toBe(5)
    expect(fromDump.counts.chapters).toBe(legacyChapters.length)
  })

  it('reads the same dump identically in one chunk and one byte at a time', async () => {
    const sql = legacyDumpSql()
    const whole = await snapshot(dumpSource(sql))
    const perCharacter = await snapshot(dumpSource(sql, { chunkSize: 1 }))
    expect(perCharacter).toEqual(whole)

    // …and the same again for bytes, so multi-byte UTF-8 is split mid-character.
    const perByte = await snapshot(
      createDumpSource({
        reader: bytesDumpReader(sql, { name: 'wordpress.sql', chunkSize: 1 }),
        dataPathPrefix: LEGACY_DUMP_DATA_PREFIX,
        uploads: null,
      }),
    )
    expect(perByte).toEqual(whole)
    // The multi-byte values really are in there.
    expect(perByte.series[0]?.meta._wp_manga_alternative).toContain('잿빛 진혼곡')
    expect(perByte.users.map((u) => u.login)).toContain('møderator')
  })

  it('reads a dump written with a different table prefix', async () => {
    const prefixed = await snapshot(
      dumpSource(legacyDumpSql({ tablePrefix: 'wpx9_' }), { tablePrefix: 'wpx9_' }),
    )
    expect(prefixed).toEqual(await snapshot(dumpSource(legacyDumpSql())))
  })

  it('finds nothing and says so when the configured prefix does not match the dump', async () => {
    const source = dumpSource(legacyDumpSql({ tablePrefix: 'wpx9_' }))
    expect(await collect(source.listSeries())).toEqual([])
    expect(source.stats().warnings.join(' ')).toContain('check the table prefix')
  })

  it('falls back to the standard column order when the dump carries no CREATE TABLE', async () => {
    const source = dumpSource(legacyDumpSql({ createTables: false }))
    expect(await snapshot(source)).toEqual(await snapshot(dumpSource(legacyDumpSql())))
    expect(source.stats().warnings.join(' ')).toContain('assuming the standard column order')
  })

  it('is unaffected by how many rows share an INSERT statement', async () => {
    const one = await snapshot(dumpSource(legacyDumpSql({ rowsPerInsert: 1 })))
    const many = await snapshot(dumpSource(legacyDumpSql({ rowsPerInsert: 500 })))
    expect(one).toEqual(many)
  })
})

describe('what the adapter reads out of the dump', () => {
  it('joins meta, terms and roles onto the streamed rows', async () => {
    const source = dumpSource(legacyDumpSql())
    const series = await collect(source.listSeries())
    const ashfall = series.find((s) => s.name === 'ashfall-requiem')
    expect(ashfall?.meta.manga_unique_id).toBe('mu-ashfall-0001')
    expect(ashfall?.terms.map((t) => t.slug)).toEqual([
      'action',
      'fantasy',
      'female-lead',
      'yoon-hae',
      'kim-doha',
      '2021',
    ])
    const users = await collect(source.listUsers())
    expect(users.map((u) => u.role)).toEqual(['administrator', 'author', 'subscriber', 'editor'])
  })

  it('drops the postmeta rows the mapping never reads', async () => {
    const source = dumpSource(legacyDumpSql())
    await collect(source.listSeries())
    const stats = source.stats()
    // Three noise keys per post across five series and three bookmarks.
    expect(stats.indexed.metaRowsSkipped).toBe(24)
    expect(stats.indexed.metaRows).toBeGreaterThan(30)
    expect(stats.rowsRead.wp_options).toBeUndefined()
  })

  it('carries only the comments that sit on a series post', async () => {
    const comments = await collect(dumpSource(legacyDumpSql()).listComments())
    expect(comments.map((c) => c.id)).toEqual([8001, 8002, 8003, 8004])
    expect(comments.map((c) => c.postId)).not.toContain(6001)
  })

  it('joins the chapter display name back together and prefers the local page storage', async () => {
    const source = dumpSource(legacyDumpSql())
    const chapters = await collect(source.listChapters(101))
    expect(chapters.map((c) => c.name)).toEqual([
      'Chapter 12.5',
      'Ch.7 - The End',
      'Vol.2 Ch.3',
      'Prologue',
    ])
    // 5005 is mirrored to imgur in the fixture dump; the rsynced local copy still wins.
    const mirrored = (await collect(source.listChapters(102))).find((c) => c.chapterId === 5005)
    expect(mirrored?.pages).toHaveLength(30)
    expect(mirrored?.pages[0]?.path).toBe('wp-content/uploads/manga/5005/01.jpg')
  })

  it('counts its passes and its bytes', async () => {
    const sql = legacyDumpSql()
    const source = dumpSource(sql)
    await collect(source.listSeries())
    const stats = source.stats()
    // One index pass plus one streaming pass for wp_posts.
    expect(stats.passes).toBe(2)
    expect(stats.bytesRead).toBe(sql.length * 2)
    expect(stats.indexed.chapters).toBe(legacyChapters.length)
    expect(stats.indexed.pages).toBe(
      legacyChapters.reduce((n, c) => n + c.pages.length, 0) + 1, // + the imgur mirror
    )
  })

  it('skips the page index entirely for a catalogue-only run', async () => {
    const source = dumpSource(legacyDumpSql(), { indexPages: false })
    const chapters = await collect(source.listChapters(101))
    expect(chapters).toHaveLength(4)
    expect(chapters.every((c) => c.pages.length === 0)).toBe(true)
    expect(source.stats().indexed.pages).toBe(0)
  })
})

describe('chapterStorage', () => {
  it('reports custom-tables when the plugin tables carry rows', async () => {
    expect(await dumpSource(legacyDumpSql()).chapterStorage()).toBe('custom-tables')
  })

  it('reports postmeta, and reads the chapters back out of it', async () => {
    const source = dumpSource(legacyDumpSql({ chapterStorage: 'postmeta' }))
    expect(await source.chapterStorage()).toBe('postmeta')
    const chapters = await collect(source.listChapters(101))
    expect(chapters.map((c) => c.name)).toEqual([
      'Chapter 12.5',
      'Ch.7 - The End',
      'Vol.2 Ch.3',
      'Prologue',
    ])
    expect(chapters[0]?.pages.map(normalisePage)).toEqual(
      legacyChapters[0]?.pages.map(normalisePage),
    )
    // discover() turns this into the "confirm the page-order meta key" warning.
    expect((await discover(source)).warnings.join(' ')).toContain('wp_postmeta')
  })

  it('reports unknown, and warns, when the dump says nothing about chapters', async () => {
    const source = dumpSource(legacyDumpSql({ chapterStorage: 'none' }))
    expect(await source.chapterStorage()).toBe('unknown')
    expect(await collect(source.listChapters(101))).toEqual([])
    expect(source.stats().warnings.join(' ')).toContain('does not say where chapters live')
  })
})

describe('readPage', () => {
  const page = (path: string): LegacyPage => ({ idx: 1, path, attachmentId: null })

  it('resolves a stored path against the injected uploads reader', async () => {
    const source = dumpSource(legacyDumpSql(), {
      uploads: memoryUploadsReader({
        'wp-content/uploads/manga/5001/01.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      }),
    })
    const chapters = await collect(source.listChapters(101))
    const first = chapters[0]?.pages[0]
    if (first === undefined) throw new Error('fixture missing')
    const image = await source.readPage(first)
    expect(image.filename).toBe('01.jpg')
    expect(image.contentType).toBe('image/jpeg')
    expect([...image.bytes]).toEqual([0xff, 0xd8, 0xff, 0xd9])
  })

  it('fails with a typed error when no uploads source is configured', async () => {
    const source = dumpSource(legacyDumpSql())
    await expect(source.readPage(page('manga/5001/01.jpg'))).rejects.toThrow(
      LegacyPageUnavailableError,
    )
    await expect(source.readPage(page('manga/5001/01.jpg'))).rejects.toMatchObject({
      name: 'LegacyPageUnavailableError',
      reason: 'uploads-not-configured',
      path: 'manga/5001/01.jpg',
    })
  })

  it('fails with `remote-storage` for a page the theme kept on a cloud host', async () => {
    const source = dumpSource(legacyDumpSql(), { uploads: memoryUploadsReader({}) })
    await expect(source.readPage(page('https://i.imgur.com/abc123.jpg'))).rejects.toMatchObject({
      reason: 'remote-storage',
    })
  })

  it('fails with `not-found` when the uploads tree is missing the file', async () => {
    const source = dumpSource(legacyDumpSql(), { uploads: memoryUploadsReader({}) })
    await expect(source.readPage(page('manga/5001/01.jpg'))).rejects.toMatchObject({
      reason: 'not-found',
    })
  })
})

describe('the report label', () => {
  it('names the file and the prefix it read with', () => {
    expect(dumpSource(legacyDumpSql()).name).toBe('wordpress.sql (mysqldump, prefix wp_)')
    expect(legacySeries).toHaveLength(5)
  })
})
