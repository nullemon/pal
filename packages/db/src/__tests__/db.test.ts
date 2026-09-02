import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_SEO_TEMPLATES, FsStorage } from '@palscans/core'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type DbHandle, executeRows } from '../client.js'
import { runMigrations } from '../migrate.js'
import {
  chapterList,
  chapterWithPages,
  genreCounts,
  homeFeed,
  latestChapters,
  popular,
  publishedAppearance,
  searchSeries,
  seriesByIds,
  seriesBySlug,
} from '../queries/index.js'
import { type SeedResult, seed } from '../seed/index.js'

const GENERATED = 24
let dir: string
let handle: DbHandle
let first: SeedResult

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-db-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  await runMigrations(handle)
  const storage = new FsStorage({ root: path.join(dir, 'storage'), publicUrl: '/_storage' })
  first = await seed(handle.db, { generatedCount: GENERATED, storage })
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

describe('migrations + seed on PGlite', () => {
  it('creates the schema with extensions, enums and generated columns', async () => {
    const ext = await executeRows<{ extname: string }>(
      handle.db,
      sql`select extname from pg_extension order by extname`,
    )
    const names = ext.map((r) => r.extname)
    expect(names).toContain('citext')
    expect(names).toContain('pg_trgm')
    const tables = await executeRows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    )
    expect(Number(tables[0]?.n)).toBeGreaterThanOrEqual(54)
    const gen = await executeRows<{ column_name: string }>(
      handle.db,
      sql`select column_name from information_schema.columns where table_name = 'series' and is_generated = 'ALWAYS' order by column_name`,
    )
    expect(gen.map((r) => r.column_name)).toEqual(['rating_avg', 'search_vector'])
  })

  it('seeds the expected counts', () => {
    expect(first.series).toBe(16 + GENERATED + 1) // + the linked novel
    expect(first.users).toBe(5 + 30)
    expect(first.genres).toBeGreaterThanOrEqual(75)
    expect(first.chapters).toBeGreaterThan(2296 + GENERATED * 5) // catalog = sum of `latest`
    expect(first.chapterPages).toBeGreaterThan(first.chapters * 8)
    expect(first.comments).toBeGreaterThan(200)
    expect(first.bookmarks).toBeGreaterThan(50)
    expect(first.ratings).toBeGreaterThan(30)
  })

  it('is idempotent', async () => {
    const storage = new FsStorage({ root: path.join(dir, 'storage'), publicUrl: '/_storage' })
    const second = await seed(handle.db, { generatedCount: GENERATED, storage })
    expect(second).toEqual(first)
  })

  it('maintains counters through triggers', async () => {
    const frost = await seriesBySlug(handle.db, 'return-of-the-frost-monarch')
    expect(frost).not.toBeNull()
    if (!frost) return
    expect(frost.chapterCount).toBe(301) // BRIEF.md: "301 chapters"
    expect(frost.ratingAvg).toBe(9.6)
    expect(frost.ratingCount).toBe(12481)
    expect(frost.bookmarkCount).toBe(81300)
    expect(frost.genres.map((g) => g.name)).toEqual(
      expect.arrayContaining(['Action', 'Fantasy', 'Regression', 'Martial Arts', 'Revenge']),
    )
    expect(frost.people.find((p) => p.credit === 'author')?.name).toBe('Han Seo-jin')
    expect(frost.people.find((p) => p.credit === 'artist')?.name).toBe('Studio Nocturne')
    expect(frost.titles.map((t) => t.title)).toContain('서리 군주의 귀환')
    expect(frost.linked?.type).toBe('novel')
    expect(frost.lastChapterAt).toBeInstanceOf(Date)
    // 12 minutes ago, give or take the test run time
    expect(Date.now() - (frost.lastChapterAt as Date).getTime()).toBeLessThan(15 * 60_000)
    const chapters = await chapterList(handle.db, frost.id)
    expect(chapters[0]?.number).toBe(301)
    expect(chapters[0]?.earlyAccessUntil).toBeInstanceOf(Date)
    expect(chapters[1]?.number).toBe(300)
    expect(chapters).toHaveLength(301)
    const withScheduled = await chapterList(handle.db, frost.id, 'asc', {
      includeUnpublished: true,
    })
    expect(withScheduled.at(-1)?.state).toBe('scheduled')
    expect(withScheduled.at(-1)?.number).toBe(302)
  })

  it('homeFeed returns pinned first with three latest chapters per series', async () => {
    const feed = await homeFeed(handle.db, { page: 1, pageSize: 20 })
    expect(feed.total).toBe(16 + GENERATED)
    expect(feed.items).toHaveLength(20)
    expect(feed.hasMore).toBe(true)
    expect(feed.items[0]?.isPinned).toBe(true)
    expect(feed.items[0]?.slug).toBe('return-of-the-frost-monarch')
    expect(feed.items[0]?.chapters.map((c) => c.number)).toEqual([301, 300, 299])
    expect(feed.items[1]?.isPinned).toBe(true)
    // after the pinned rows, strictly newest-first
    const times = feed.items.slice(2).map((it) => (it.lastChapterAt as Date).getTime())
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1] as number).toBeGreaterThanOrEqual(times[i] as number)
    }
    expect(feed.items[2]?.slug).toBe('ashfall-regent')
    const page2 = await homeFeed(handle.db, { page: 2, pageSize: 20 })
    expect(page2.items).toHaveLength(20)
    expect(page2.items[0]?.id).not.toBe(feed.items[0]?.id)
  })

  it('popular follows the catalog order for every window', async () => {
    for (const window of ['weekly', 'monthly', 'all'] as const) {
      const top = await popular(handle.db, window, { limit: 10 })
      expect(top.map((t) => t.slug)).toEqual([
        'return-of-the-frost-monarch',
        'ashfall-regent',
        'solo-cartographer',
        'the-villainess-keeps-the-receipts',
        'the-ninth-sword-saint',
        'overgrowth',
        'dawnbreaker-guild',
        'ironclad-heir',
        'gilded-dungeon-broker',
        'crown-of-static',
      ])
      expect(top[0]?.rank).toBe(1)
      expect(top[0]?.views).toBeGreaterThan(top[9]?.views ?? 0)
    }
  })

  it('chapterWithPages returns ordered pages with dimensions and neighbours', async () => {
    const frost = await seriesBySlug(handle.db, 'return-of-the-frost-monarch')
    const ch = await chapterWithPages(handle.db, frost?.id as number, 301)
    expect(ch).not.toBeNull()
    expect(ch?.pages).toHaveLength(34)
    expect(ch?.pages[0]?.idx).toBe(0)
    // Dimensions are read off the seeded artwork rather than pinned to a number, so
    // regenerating the art cannot turn a green suite red. What matters is that every page
    // carries real intrinsic dimensions — that is what makes the reader layout-shift free.
    expect(ch?.pages[0]?.width).toBeGreaterThan(0)
    expect(ch?.pages[0]?.height).toBeGreaterThan(0)
    expect(ch?.pages[0]?.variants[0]?.w).toBe(ch?.pages[0]?.width)
    expect(ch?.pages[0]?.key).toMatch(/^pages\/page-c-\d+\.svg$/)
    expect(ch?.chapter.pageCount).toBe(34)
    expect(ch?.prev?.number).toBe(300)
    expect(ch?.next).toBeNull() // 302 is scheduled, not published
    expect(ch?.series.readingDirection).toBe('vertical')
    const overgrowth = await seriesBySlug(handle.db, 'overgrowth')
    const m = await chapterWithPages(handle.db, overgrowth?.id as number, 100)
    expect(m?.pages[0]?.key).toMatch(/^pages\/page-m-\d+\.svg$/)
    expect(m?.series.readingDirection).toBe('rtl')
    expect(m?.prev?.number).toBe(99)
    expect(m?.next?.number).toBe(101)
    expect(await chapterWithPages(handle.db, overgrowth?.id as number, 9999)).toBeNull()
  })

  it('soft-deleted series vanish from every read path', async () => {
    const target = await seriesBySlug(handle.db, 'ironclad-heir')
    expect(target).not.toBeNull()
    if (!target) return
    const latestBefore = await latestChapters(handle.db, 5000)
    expect(latestBefore.some((c) => c.seriesId === target.id)).toBe(true)
    expect((await seriesByIds(handle.db, [target.id])).map((r) => r.id)).toEqual([target.id])
    const latestNumber = latestBefore.find((c) => c.seriesId === target.id)?.number as number
    expect(await chapterWithPages(handle.db, target.id, latestNumber)).not.toBeNull()

    await handle.db.execute(sql`update series set deleted_at = now() where id = ${target.id}`)
    try {
      const latestAfter = await latestChapters(handle.db, 5000)
      expect(latestAfter.some((c) => c.seriesId === target.id)).toBe(false)
      expect(await seriesByIds(handle.db, [target.id])).toEqual([])
      expect(await chapterWithPages(handle.db, target.id, latestNumber)).toBeNull()
      // staff paths still see it
      expect(
        await chapterWithPages(handle.db, target.id, latestNumber, { includeUnpublished: true }),
      ).not.toBeNull()
      const feed = await homeFeed(handle.db, { page: 1, pageSize: 100 })
      expect(feed.items.some((it) => it.id === target.id)).toBe(false)
    } finally {
      await handle.db.execute(sql`update series set deleted_at = null where id = ${target.id}`)
    }
  })

  it('searchSeries uses FTS, trigram and alternative titles', async () => {
    expect((await searchSeries(handle.db, 'frost monarch'))[0]?.slug).toBe(
      'return-of-the-frost-monarch',
    )
    expect((await searchSeries(handle.db, 'frost mon'))[0]?.slug).toBe(
      'return-of-the-frost-monarch',
    )
    expect((await searchSeries(handle.db, 'villaness recipts'))[0]?.slug).toBe(
      'the-villainess-keeps-the-receipts',
    )
    const alt = await searchSeries(handle.db, "Frost Monarch's Return")
    expect(alt[0]?.slug).toBe('return-of-the-frost-monarch')
    const ko = await searchSeries(handle.db, '서리 군주')
    expect(ko[0]?.slug).toBe('return-of-the-frost-monarch')
    expect(ko[0]?.matchedTitle).toBe('서리 군주의 귀환')
    expect(await searchSeries(handle.db, '')).toEqual([])
    expect(await searchSeries(handle.db, 'zzzzqqqq')).toEqual([])
  })

  it('genreCounts and settings', async () => {
    const counts = await genreCounts(handle.db)
    const action = counts.find((g) => g.slug === 'action')
    expect(action?.count).toBeGreaterThanOrEqual(5)
    expect(counts.find((g) => g.slug === 'regression')?.kind).toBe('theme')
    const appearance = await publishedAppearance(handle.db)
    expect(appearance?.status).toBe('published')
    expect(appearance?.resolvedCss).toContain('--color-brand:#7c3aed')
    expect(appearance?.resolvedCss).toContain(':root[data-theme="light"]')
    const settings = await executeRows<{ key: string; value: unknown }>(
      handle.db,
      sql`select key, value from settings order by key`,
    )
    const layouts = settings.find((r) => r.key === 'layouts')?.value as {
      home: string
      series: string
    }
    expect(layouts).toMatchObject({ home: 'A', series: 'B', reader: { default_mode: 'strip' } })
    const seo = await executeRows<{ value: { series: { title: string } } }>(
      handle.db,
      sql`select value from seo_settings where key = 'templates'`,
    )
    const templates = seo[0]?.value
    // Compared against the shipped defaults, not a copy of them: the separator is a
    // variable now (docs/12 §2), and a duplicated literal here just goes stale.
    expect(templates?.series.title).toBe(DEFAULT_SEO_TEMPLATES.series.title)
    expect(templates?.series.title).toContain('{sep}')
    const premium = await executeRows<{ feature: string }>(
      handle.db,
      sql`select feature from entitlements e join users u on u.id = e.user_id where u.email = 'premium@palscans.org' order by feature`,
    )
    expect(premium.map((r) => r.feature)).toEqual(['early_access', 'no_ads', 'premium_content'])
    const pending = await executeRows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from comments where status = 'pending'`,
    )
    expect(Number(pending[0]?.n)).toBe(1)
    const reacted = await executeRows<{ s: number }>(
      handle.db,
      sql`select max(score)::int as s from comments`,
    )
    expect(Number(reacted[0]?.s)).toBeGreaterThan(0)
  })
})
