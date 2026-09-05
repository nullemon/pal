import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LocalProgress } from './types'

/**
 * The device's own half of "do not lose my place".
 *
 * Two properties matter and neither is obvious from reading the code: what a signed-out
 * reader is shown is the *newest* record per chapter and per series, folded from two
 * stores; and a browser that refuses to store anything must degrade to "no progress"
 * rather than to a thrown exception on the reader's critical path.
 */

class FakeStorage {
  private readonly items = new Map<string, string>()
  /** Private browsing: reads succeed, writes throw. Safari's actual behaviour. */
  refuseWrites = false
  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.refuseWrites) throw new DOMException('QuotaExceededError')
    this.items.set(key, value)
  }
  removeItem(key: string): void {
    this.items.delete(key)
  }
}

let storage: FakeStorage

beforeEach(() => {
  storage = new FakeStorage()
  ;(globalThis as { window?: unknown }).window = { localStorage: storage }
})

afterEach(() => {
  ;(globalThis as { window?: unknown }).window = undefined
})

const { JOURNAL_KEY, JOURNAL_LIMIT, mergeRows, newestPerSeries, readJournal, rememberInJournal } =
  await import('./journal')

const row = (over: Partial<LocalProgress> & { chapterId: number }): LocalProgress => ({
  seriesId: 1,
  seriesSlug: 'frost-monarch',
  seriesTitle: 'Frost Monarch',
  seriesHref: '/series/frost-monarch',
  seriesType: 'manhwa',
  coverSrc: null,
  chapterNumber: over.chapterId,
  chapterLabel: `Chapter ${over.chapterId}`,
  chapterHref: `/series/frost-monarch/chapter-${over.chapterId}`,
  pageIdx: 0,
  pageCount: 20,
  scrollPct: 0,
  updatedAt: 1_800_000_000_000,
  ...over,
})

describe('the journal', () => {
  it('keeps one record per chapter, newest first', () => {
    rememberInJournal(row({ chapterId: 10, pageIdx: 2, updatedAt: 100 }))
    rememberInJournal(row({ chapterId: 11, pageIdx: 1, updatedAt: 200 }))
    rememberInJournal(row({ chapterId: 10, pageIdx: 9, updatedAt: 300 }))
    const journal = readJournal()
    expect(journal).toHaveLength(2)
    expect(journal[0]).toMatchObject({ chapterId: 10, pageIdx: 9 })
    expect(journal[1]).toMatchObject({ chapterId: 11 })
  })

  it('caps itself, dropping the oldest rather than growing without end', () => {
    for (let i = 0; i < JOURNAL_LIMIT + 10; i++)
      rememberInJournal(row({ chapterId: i + 1, updatedAt: i }))
    const journal = readJournal()
    expect(journal).toHaveLength(JOURNAL_LIMIT)
    expect(journal[0]?.chapterId).toBe(JOURNAL_LIMIT + 10)
  })

  it('treats a corrupt journal as an empty one instead of throwing', () => {
    storage.setItem(JOURNAL_KEY, '{not json')
    expect(readJournal()).toEqual([])
    storage.setItem(JOURNAL_KEY, JSON.stringify([{ chapterId: 'nope' }]))
    expect(readJournal()).toEqual([])
  })

  it('reports a refused write instead of throwing into the reader', () => {
    storage.refuseWrites = true
    expect(rememberInJournal(row({ chapterId: 1 }))).toBe(false)
    expect(readJournal()).toEqual([])
  })

  it('survives a browser with no storage object at all', () => {
    ;(globalThis as { window?: unknown }).window = {}
    expect(readJournal()).toEqual([])
    expect(rememberInJournal(row({ chapterId: 1 }))).toBe(false)
  })
})

describe('folding the two stores together', () => {
  it('takes the newest record for a chapter, whichever store it came from', () => {
    const journal = [row({ chapterId: 10, pageIdx: 9, updatedAt: 300 })]
    const indexed = [
      row({ chapterId: 10, pageIdx: 2, updatedAt: 100 }),
      row({ chapterId: 11, pageIdx: 1, updatedAt: 200 }),
    ]
    const merged = mergeRows(journal, indexed)
    expect(merged.map((r) => [r.chapterId, r.pageIdx])).toEqual([
      [10, 9],
      [11, 1],
    ])
  })

  it('reduces "Continue reading" to the newest chapter in each series', () => {
    const rows = [
      row({ chapterId: 10, seriesId: 1, updatedAt: 100 }),
      row({ chapterId: 12, seriesId: 1, updatedAt: 300 }),
      row({ chapterId: 40, seriesId: 2, updatedAt: 200 }),
    ]
    expect(newestPerSeries(rows).map((r) => r.chapterId)).toEqual([12, 40])
  })

  it('shows the most recent chapter, not the furthest — the same rule the server applies', () => {
    // Read chapter 12, then went back to re-read chapter 3. "Continue" means chapter 3.
    const rows = [
      row({ chapterId: 12, chapterNumber: 12, seriesId: 1, updatedAt: 100 }),
      row({ chapterId: 3, chapterNumber: 3, seriesId: 1, updatedAt: 500 }),
    ]
    expect(newestPerSeries(rows)[0]?.chapterNumber).toBe(3)
  })
})

describe('a journal row that has gone stale or been hand-edited', () => {
  /**
   * The parser replaced a zod schema (zod is 84 KB gzipped and this runs before the reader's
   * first paint), so the split it encoded is worth asserting directly: three fields fall back
   * to a default and everything else disqualifies the row.
   */
  const write = (rows: unknown[]) => storage.setItem(JOURNAL_KEY, JSON.stringify(rows))

  it('falls back rather than dropping the row for coverSrc, pageCount and scrollPct', () => {
    write([{ ...row({ chapterId: 1 }), coverSrc: 42, pageCount: 'lots', scrollPct: 9 }])
    expect(readJournal()).toEqual([
      { ...row({ chapterId: 1 }), coverSrc: null, pageCount: 0, scrollPct: 0 },
    ])
  })

  it('keeps a scroll position that is in range', () => {
    write([{ ...row({ chapterId: 1 }), scrollPct: 0.5 }])
    expect(readJournal()[0]?.scrollPct).toBe(0.5)
  })

  it('drops a row missing or malformed anywhere else, and keeps its neighbours', () => {
    for (const bad of [
      { chapterId: 0 },
      { chapterId: 1.5 },
      { seriesSlug: '' },
      { seriesTitle: 7 },
      { pageIdx: -1 },
      { chapterNumber: 'twelve' },
      { updatedAt: undefined },
    ]) {
      write([{ ...row({ chapterId: 1 }), ...bad }, row({ chapterId: 2 })])
      expect(
        readJournal().map((r) => r.chapterId),
        JSON.stringify(bad),
      ).toEqual([2])
    }
  })

  it('reads an empty journal from anything that is not an array', () => {
    for (const junk of ['{}', 'null', '3', '"[]"']) {
      storage.setItem(JOURNAL_KEY, junk)
      expect(readJournal()).toEqual([])
    }
  })
})
