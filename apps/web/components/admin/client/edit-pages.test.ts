import type { WatermarkPageState } from '@palscans/core/watermark'
import { describe, expect, it } from 'vitest'
import { canEditPages } from './util'

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
