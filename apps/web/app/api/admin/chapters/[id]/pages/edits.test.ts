import type { ChapterProcessing } from '@palscans/db'
import { describe, expect, it } from 'vitest'
import { applyPageEdits } from '@/components/admin/server/chapter-pages'

/**
 * Translating what the grid sends into an edit of the processing document.
 *
 * The core module is tested against positions; this layer is tested against *ids*, because
 * that is the part the grid depends on. Positions shift the moment anything is deleted, so an
 * editor that staged a delete and a drag together and sent both as positions would reorder
 * whichever pages happened to land there — silently, and differently depending on the order
 * the operator happened to do things in. Ids are stable, so they cannot drift that way.
 */

const source = (idx: number, key: string) => ({ idx, key, bytes: 1, sha256: key })
const page = (key: string) => ({
  key,
  width: 800,
  height: 1200,
  bytes: 1,
  blurHash: null,
  variants: [],
})

/** Three uploads; `b` was a long strip and split into three pages. */
const doc = (): ChapterProcessing => ({
  sources: [source(0, 'a'), source(1, 'b'), source(2, 'c')],
  results: {
    '0': [page('a0')],
    '1': [page('b0'), page('b1'), page('b2')],
    '2': [page('c0')],
  },
  errors: {},
  progress: { done: 3, total: 3 },
  attempt: 1,
  startedAt: null,
  finishedAt: null,
})

/** The page keys, in display order — what the reader would see. */
const order = (d: ChapterProcessing): string[] =>
  [...d.sources]
    .sort((x, y) => x.idx - y.idx)
    .flatMap((s) =>
      (d.results?.[String(s.idx)] ?? [])
        .map((p, seg) => ({ key: p.key, ref: `${s.idx}:${seg}` }))
        .filter((p) => !(d.dropped ?? []).includes(p.ref))
        .map((p) => p.key),
    )

describe('applyPageEdits', () => {
  it('deletes by id', () => {
    expect(order(applyPageEdits(doc(), { deleted: ['0:0'] }))).toEqual(['b0', 'b1', 'b2', 'c0'])
  })

  it('deletes one page of a split upload without taking its siblings', () => {
    expect(order(applyPageEdits(doc(), { deleted: ['1:1'] }))).toEqual(['a0', 'b0', 'b2', 'c0'])
  })

  it('reorders by id', () => {
    const out = applyPageEdits(doc(), { order: ['2:0', '0:0', '1:0'] })
    expect(order(out)).toEqual(['c0', 'a0', 'b0', 'b1', 'b2'])
  })

  it('moves a split upload as a block when one of its pages is dragged', () => {
    // The grid may name only the middle segment; the whole upload still moves, because the
    // segments are regenerated together from one original.
    const out = applyPageEdits(doc(), { order: ['1:1', '0:0', '2:0'] })
    expect(order(out)).toEqual(['b0', 'b1', 'b2', 'a0', 'c0'])
  })

  it('applies a delete and a reorder sent together', () => {
    // The case that makes ids necessary. Deleting `a` shifts every position by one, so a
    // position-based order computed before the delete would move the wrong pages.
    const out = applyPageEdits(doc(), { deleted: ['0:0'], order: ['2:0', '1:0'] })
    expect(order(out)).toEqual(['c0', 'b0', 'b1', 'b2'])
  })

  it('tolerates an order naming a page that is being deleted', () => {
    // The grid does not have to filter its own order against its own pending deletions.
    const out = applyPageEdits(doc(), { deleted: ['0:0'], order: ['0:0', '2:0', '1:0'] })
    expect(order(out)).toEqual(['c0', 'b0', 'b1', 'b2'])
  })

  it('keeps unmentioned uploads rather than dropping them', () => {
    // A partial order is a partial order. Treating it as the complete list would delete
    // everything the caller did not name, which is not what a partial drag means.
    expect(order(applyPageEdits(doc(), { order: ['2:0'] }))).toEqual(['c0', 'a0', 'b0', 'b1', 'b2'])
  })

  it('ignores ids that do not exist', () => {
    expect(order(applyPageEdits(doc(), { deleted: ['9:9'] }))).toEqual([
      'a0',
      'b0',
      'b1',
      'b2',
      'c0',
    ])
    expect(order(applyPageEdits(doc(), { order: ['9:9', '2:0'] }))).toEqual([
      'c0',
      'a0',
      'b0',
      'b1',
      'b2',
    ])
  })

  it('records the deletion so a reprocessing run cannot undo it', () => {
    // `results` is rebuilt from the originals by watermark.reapply and by any retry, so a
    // deletion that lived only there would come back. This is the field that outlives it.
    const out = applyPageEdits(doc(), { deleted: ['1:1'] })
    expect(out.dropped).toContain('1:1')
  })

  it('drops the upload entirely once its last page goes', () => {
    const out = applyPageEdits(doc(), { deleted: ['1:0', '1:1', '1:2'] })
    expect(order(out)).toEqual(['a0', 'c0'])
    expect(out.sources.map((s) => s.key)).toEqual(['a', 'c'])
  })
})
