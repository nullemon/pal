import type { WatermarkPageState } from '@palscans/core/watermark'
import { describe, expect, it } from 'vitest'
import {
  canEditPages,
  chapterNumberClash,
  duplicateNumberKeys,
  movePagesTo,
  resolveDuplicateNumbers,
} from './util'

/**
 * Which chapters offer the page editor from a series' Chapters tab.
 *
 * The editor rewrites the processing document — reorder, delete, replace one page, insert
 * one — and that document describes the originals in our own bucket. A chapter imported in
 * remote mode has none: its pages are served from the host that already had them. Offering
 * the link there opens an empty grid, which reads as a broken screen rather than as the
 * deliberate limit it is, so the rule is asserted here rather than left to a JSX condition
 * nobody re-reads.
 */

interface Row {
  pageCount: number
  watermark: WatermarkPageState
  deletedAt: string | null
}

const row = (over: Partial<Row> = {}): Row => ({
  pageCount: 22,
  watermark: 'current',
  deletedAt: null,
  ...over,
})

describe('canEditPages', () => {
  it('offers it for a chapter stored on our side', () => {
    expect(canEditPages(row())).toBe(true)
  })

  it('offers it whatever the mark says, as long as the pages are ours', () => {
    // `stale` and `unknown` are about which watermark was burned in, not about whether the
    // pages exist — an old mark is no reason to refuse a reorder.
    for (const watermark of ['stale', 'unknown', 'unmarkable'] as WatermarkPageState[])
      expect(canEditPages(row({ watermark })), watermark).toBe(true)
  })

  it('does not offer it for an imported chapter whose pages live on the host', () => {
    expect(canEditPages(row({ watermark: 'remote' }))).toBe(false)
  })

  it('does not offer it before there are any pages to edit', () => {
    expect(canEditPages(row({ pageCount: 0, watermark: 'unprocessed' }))).toBe(false)
  })

  it('does not offer it for a deleted chapter', () => {
    expect(canEditPages(row({ deletedAt: new Date().toISOString() }))).toBe(false)
  })
})

/**
 * Duplicate chapter numbers in one bulk drop.
 *
 * The uploader blocks Upload while two chapters claim one number, which is right — the
 * server would otherwise write both into a single chapter row. What was wrong was that the
 * block could not be cleared: the issue came from the plan built when the folders were
 * dropped, and editing a number did not rebuild it, so the button stayed disabled however
 * the numbers were retyped.
 */
describe('duplicateNumberKeys', () => {
  it('finds nothing when every number is distinct', () => {
    expect(duplicateNumberKeys(['1', '2', '3.5'])).toEqual(new Set())
  })

  it('finds a number two chapters both claim', () => {
    expect(duplicateNumberKeys(['7', '7', '8'])).toEqual(new Set(['7.000']))
  })

  it('treats 7 and 7.0 as one number, because the unique index does', () => {
    // The bulk plan compares the typed strings and lets this pair through; the server then
    // has to refuse the batch. Normalising here means the operator is told before uploading.
    expect(duplicateNumberKeys(['7', '7.0'])).toEqual(new Set(['7.000']))
  })

  it('clears once the operator retypes one of them — the point of recomputing', () => {
    expect(duplicateNumberKeys(['7', '7.5'])).toEqual(new Set())
  })

  it('ignores entries whose number has not been typed yet', () => {
    // Those are reported as `no number found` and blocked by their own warning, not this one.
    expect(duplicateNumberKeys(['', 'abc', '4'])).toEqual(new Set())
  })

  it('reports several clashes at once', () => {
    expect(duplicateNumberKeys(['1', '1', '2', '2', '3'])).toEqual(new Set(['1.000', '2.000']))
  })
})

/**
 * The one-click fix for a drop where two folders read as the same chapter.
 *
 * Retyping the numbers by hand is the alternative, one field at a time — which on a
 * ten-chapter clash is why an operator gives up and uploads them individually instead.
 */
describe('resolveDuplicateNumbers', () => {
  it('leaves a clean drop exactly as it is', () => {
    expect(resolveDuplicateNumbers(['1', '2', '3'])).toEqual(['1', '2', '3'])
  })

  it('keeps the first claim and moves the second under it', () => {
    // 7 and 7.1, the conventional numbering for a two-part release.
    expect(resolveDuplicateNumbers(['7', '7'])).toEqual(['7', '7.1'])
  })

  it('spreads a three-way clash', () => {
    expect(resolveDuplicateNumbers(['7', '7', '7'])).toEqual(['7', '7.1', '7.2'])
  })

  it('steps over a decimal the drop already uses, rather than creating a new clash', () => {
    expect(resolveDuplicateNumbers(['7', '7.1', '7'])).toEqual(['7', '7.1', '7.2'])
  })

  it('resolves 7 and 7.0, which the database considers one number', () => {
    expect(resolveDuplicateNumbers(['7', '7.0'])).toEqual(['7', '7.1'])
  })

  it('never moves a chapter that was already unique', () => {
    expect(resolveDuplicateNumbers(['1', '7', '7', '12'])).toEqual(['1', '7', '7.1', '12'])
  })

  it('leaves an entry whose number has not been typed yet alone', () => {
    // It carries its own "no number found" warning; inventing one would be inventing data.
    expect(resolveDuplicateNumbers(['', '7', '7'])).toEqual(['', '7', '7.1'])
  })

  it('leaves nothing clashing behind, which is the whole contract', () => {
    const fixed = resolveDuplicateNumbers(['3', '3', '3', '3.1', '3.2'])
    expect(duplicateNumberKeys(fixed)).toEqual(new Set())
  })
})

/**
 * Moving several pages at once.
 *
 * The editor could delete a selection but only move one page at a time, which on a 40-page
 * chapter is forty drags. The rule worth pinning is that a selection keeps its own order —
 * moving pages 12–15 to the end means those four, still in that sequence.
 */
describe('movePagesTo', () => {
  const pages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const ids = (...xs: string[]) => new Set(xs)

  it('moves a selection to the back, keeping its order', () => {
    expect(movePagesTo(pages, ids('a', 'b'), 'back').map((p) => p.id)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('moves a selection to the front, keeping its order', () => {
    expect(movePagesTo(pages, ids('c', 'd'), 'front').map((p) => p.id)).toEqual([
      'c',
      'd',
      'a',
      'b',
    ])
  })

  it('keeps the selection in page order, not in the order it was clicked', () => {
    expect(movePagesTo(pages, ids('d', 'b'), 'back').map((p) => p.id)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('does nothing when nothing is selected', () => {
    expect(movePagesTo(pages, ids(), 'back').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('loses no pages when everything is selected', () => {
    expect(movePagesTo(pages, ids('a', 'b', 'c', 'd'), 'front').map((p) => p.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })
})

/**
 * Whether a renumber would collide with another chapter.
 *
 * The first version compared the number alone and refused a rename the database would have
 * accepted: a series carrying a German 1196 and an English 1196.1 is two translations, not a
 * clash, and the unique index is on `(series, number, language)`. It refused on exactly the
 * dual-language series the edit dialog exists for.
 */
describe('chapterNumberClash', () => {
  const rows = [
    { id: 1, number: 1196, language: 'de', title: 'Die Liebe', deletedAt: null },
    { id: 2, number: 1196.1, language: 'en', title: 'Love From Someone', deletedAt: null },
    { id: 3, number: 1195, language: 'en', title: 'Weak Point', deletedAt: null },
  ]

  it('allows a number another language already uses', () => {
    // The case from the panel: renumbering the English 1196.1 to 1196 beside a German 1196.
    expect(chapterNumberClash(rows, 2, 1196, 'en')).toBeNull()
  })

  it('refuses a number the same language already uses', () => {
    expect(chapterNumberClash(rows, 2, 1195, 'en')?.id).toBe(3)
  })

  it('refuses when the edit also switches language onto a taken number', () => {
    expect(chapterNumberClash(rows, 2, 1196, 'de')?.id).toBe(1)
  })

  it('does not count the chapter being edited against itself', () => {
    expect(chapterNumberClash(rows, 3, 1195, 'en')).toBeNull()
  })

  /**
   * The one that cost an evening. Deleting a chapter does not give its number back — the
   * unique constraint covers soft-deleted rows — so a deleted draft nobody can see still
   * blocks the rename. This originally asserted the opposite, which is why the dialog said
   * "already taken" while the list showed nothing taking it, and the only way to find the
   * culprit was a SQL query against the live database.
   */
  it('counts a deleted chapter, which still holds its number in the database', () => {
    const withDeleted = [
      ...rows,
      { id: 4, number: 900, language: 'en', title: 'Failed import', deletedAt: '2026-01-01' },
    ]
    expect(chapterNumberClash(withDeleted, 3, 900, 'en')?.id).toBe(4)
  })

  it('reports the deleted blocker as deleted, so the remedy is obvious', () => {
    // A live clash means pick another number; a deleted one means restore or purge it.
    const withDeleted = [
      ...rows,
      { id: 4, number: 900, language: 'en', title: 'Failed import', deletedAt: '2026-01-01' },
    ]
    expect(chapterNumberClash(withDeleted, 3, 900, 'en')?.deletedAt).toBe('2026-01-01')
  })

  it('treats 7 and 7.0 as the same number', () => {
    const pair = [{ id: 1, number: 7, language: 'en', title: null, deletedAt: null }]
    expect(chapterNumberClash(pair, 2, 7.0, 'en')?.id).toBe(1)
  })
})
