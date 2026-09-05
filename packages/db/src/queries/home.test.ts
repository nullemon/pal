import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle } from '../client.js'
import { runMigrations } from '../migrate.js'
import { chapters, series } from '../schema/index.js'
import { pageWindow } from './_shared.js'
import { homeFeed } from './home.js'
import { randomPublishedSeries } from './series.js'

/**
 * The two discovery behaviours that only a real database can show: that the latest-updates
 * feed refuses to build a page that does not exist, and that `/random` is actually random
 * *and* actually published. Both are cheap to get subtly wrong and expensive to notice —
 * an unclamped page is a cache entry per URL, and a "random" pick that is a constant looks
 * fine in every screenshot.
 */

let dir: string
let handle: DbHandle
let db: Db

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-home-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
})

afterAll(async () => {
  await handle?.close()
  if (dir) await rm(dir, { recursive: true, force: true })
})

const wipe = async () => {
  await db.delete(chapters)
  await db.delete(series)
}

describe('pageWindow', () => {
  it('never returns a page below the first or past the last', () => {
    // 45 rows at 20 a page is three pages.
    expect(pageWindow(1, 45, 20)).toEqual({ page: 1, totalPages: 3 })
    expect(pageWindow(3, 45, 20)).toEqual({ page: 3, totalPages: 3 })
    expect(pageWindow(4, 45, 20)).toEqual({ page: 3, totalPages: 3 })
    // The value `?page=` accepts at the top of its range, which is the whole problem.
    expect(pageWindow(10_000, 45, 20)).toEqual({ page: 3, totalPages: 3 })
    expect(pageWindow(0, 45, 20)).toEqual({ page: 1, totalPages: 3 })
    expect(pageWindow(-7, 45, 20)).toEqual({ page: 1, totalPages: 3 })
  })

  it('calls an empty catalogue one page, not zero', () => {
    // A page count of 0 would clamp every request to page 0 and offset -20.
    expect(pageWindow(1, 0, 20)).toEqual({ page: 1, totalPages: 1 })
    expect(pageWindow(9_999, 0, 20)).toEqual({ page: 1, totalPages: 1 })
  })

  it('survives the junk a query string can carry', () => {
    expect(pageWindow(undefined, 45, 20).page).toBe(1)
    expect(pageWindow(Number.NaN, 45, 20).page).toBe(1)
    expect(pageWindow(2.9, 45, 20).page).toBe(2)
    expect(pageWindow(1, Number.NaN, 20)).toEqual({ page: 1, totalPages: 1 })
  })
})

describe('homeFeed', () => {
  beforeAll(async () => {
    await wipe()
    const at = (days: number) => new Date(Date.UTC(2026, 0, 1) - days * 86_400_000)
    // Seven published series with a chapter, newest first, plus one pinned that is the
    // *oldest* of them — so "pinned first" and "newest first" disagree and the order proves
    // which one wins. Two more rows that must never appear: a draft and a soft-deleted one.
    await db.insert(series).values([
      ...Array.from({ length: 7 }, (_, i) => ({
        slug: `feed-${i}`,
        title: `Feed ${i}`,
        type: 'manhwa' as const,
        state: 'published' as const,
        lastChapterAt: at(i),
      })),
      {
        slug: 'pinned',
        title: 'Pinned',
        type: 'manhwa' as const,
        state: 'published' as const,
        isPinned: true,
        lastChapterAt: at(99),
      },
      {
        slug: 'draft',
        title: 'Draft',
        type: 'manhwa' as const,
        state: 'draft' as const,
        lastChapterAt: at(0),
      },
      {
        slug: 'deleted',
        title: 'Deleted',
        type: 'manhwa' as const,
        state: 'published' as const,
        lastChapterAt: at(0),
        deletedAt: new Date(),
      },
      // Published but never released a chapter: the feed is "latest updates", not "catalogue".
      { slug: 'no-chapters', title: 'No chapters', type: 'manhwa' as const, state: 'published' },
    ])
  })

  it('puts the pinned series first and orders the rest newest-update first', async () => {
    const feed = await homeFeed(db, { page: 1, pageSize: 20 })
    expect(feed.items.map((i) => i.slug)).toEqual([
      'pinned',
      'feed-0',
      'feed-1',
      'feed-2',
      'feed-3',
      'feed-4',
      'feed-5',
      'feed-6',
    ])
    expect(feed.total).toBe(8)
    expect(feed.totalPages).toBe(1)
  })

  it('clamps a page past the end onto the last one instead of serving nothing', async () => {
    const last = await homeFeed(db, { page: 3, pageSize: 3 })
    expect(last.page).toBe(3)
    expect(last.totalPages).toBe(3)
    expect(last.items.map((i) => i.slug)).toEqual(['feed-5', 'feed-6'])

    // The shape of the abuse: `?page=` accepts up to 10,000, and every distinct value used to
    // be its own render *and* its own cache entry. All of them are now the last real page.
    for (const asked of [4, 50, 10_000]) {
      const over = await homeFeed(db, { page: asked, pageSize: 3 })
      expect(over.page).toBe(3)
      expect(over.items.map((i) => i.slug)).toEqual(['feed-5', 'feed-6'])
      expect(over.hasMore).toBe(false)
    }
  })

  it('clamps a page below the first, too', async () => {
    const under = await homeFeed(db, { page: -12, pageSize: 3 })
    expect(under.page).toBe(1)
    expect(under.items[0]?.slug).toBe('pinned')
  })

  it('reports one page for an empty feed rather than page 0', async () => {
    await db.delete(series).where(eq(series.slug, 'pinned'))
    const empty = await homeFeed(db, { page: 500, pageSize: 3 })
    expect(empty.page).toBeGreaterThanOrEqual(1)
    expect(empty.totalPages).toBeGreaterThanOrEqual(1)
  })
})

describe('randomPublishedSeries', () => {
  /** 300 rolls of the die, as slugs. */
  const roll = async (times: number): Promise<string[]> => {
    const out: string[] = []
    for (let i = 0; i < times; i++) {
      const slug = await randomPublishedSeries(db)
      if (slug !== null) out.push(slug)
    }
    return out
  }

  it('returns nothing at all when there is nothing to return', async () => {
    await wipe()
    expect(await randomPublishedSeries(db)).toBeNull()
  })

  it('never returns a draft, a removed series or a deleted one', async () => {
    await wipe()
    // The published rows are outnumbered four to one and sit at both ends of the id range,
    // so a probe that ignored `state` would land on an unpublishable row most of the time.
    await db.insert(series).values(
      Array.from({ length: 50 }, (_, i) => ({
        slug: `mix-${i}`,
        title: `Mix ${i}`,
        type: 'manga' as const,
        state: (i % 5 === 0 ? 'published' : i % 5 === 1 ? 'draft' : 'removed') as
          | 'published'
          | 'draft'
          | 'removed',
        deletedAt: i % 5 === 4 ? new Date() : null,
      })),
    )
    const rolls = await roll(120)
    expect(rolls).toHaveLength(120)
    const live = new Set(
      (
        await db.select({ slug: series.slug }).from(series).where(eq(series.state, 'published'))
      ).map((r) => r.slug),
    )
    for (const slug of rolls) expect(live.has(slug)).toBe(true)
  })

  it('still answers when exactly one series qualifies', async () => {
    await wipe()
    await db.insert(series).values([
      ...Array.from({ length: 20 }, (_, i) => ({
        slug: `hidden-${i}`,
        title: `Hidden ${i}`,
        type: 'manga' as const,
        state: 'draft' as const,
      })),
      { slug: 'the-only-one', title: 'The only one', type: 'manga' as const, state: 'published' },
    ])
    const rolls = await roll(25)
    expect(new Set(rolls)).toEqual(new Set(['the-only-one']))
  })

  it('spreads its picks over the whole catalogue instead of favouring one row', async () => {
    await wipe()
    const size = 30
    // Gaps between the published ids on purpose: drafts scattered through the range are what
    // makes a naive "first published id at or after a random id" pick unfair, and this is the
    // test that would catch it drifting back to that.
    const rows: { slug: string; title: string; type: 'manhwa'; state: 'published' | 'draft' }[] = []
    for (let i = 0; i < size; i++) {
      rows.push({ slug: `pick-${i}`, title: `Pick ${i}`, type: 'manhwa', state: 'published' })
      if (i % 3 === 0)
        rows.push({ slug: `gap-${i}`, title: `Gap ${i}`, type: 'manhwa', state: 'draft' })
    }
    await db.insert(series).values(rows)

    const draws = 900
    const rolls = await roll(draws)
    const counts = new Map<string, number>()
    for (const slug of rolls) counts.set(slug, (counts.get(slug) ?? 0) + 1)

    // Every published series comes up at least once. With 900 draws over 30 rows the chance
    // of a uniform picker missing any of them is about one in 10^5, and a picker that always
    // answered the same row — the failure this test exists for — misses 29 of them.
    expect(counts.size).toBe(size)
    // …and none of them dominates: 1/30 is 3.3%, so a fifth of the draws is far outside
    // anything sampling noise produces and well inside what a biased picker produces.
    const worst = Math.max(...counts.values())
    expect(worst).toBeLessThan(draws * 0.2)
  })
})
