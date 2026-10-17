import type { WatermarkPageState } from '@palscans/core/watermark'
import { describe, expect, it } from 'vitest'
import { canEditPages, duplicateNumberKeys } from './util'

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
