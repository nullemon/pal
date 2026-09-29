import { describe, expect, it } from 'vitest'
import {
  deletePages,
  flattenPages,
  movePage,
  type PagePlan,
  pageRefKey,
  reorderSources,
} from '../chapters/pages.js'

/**
 * Editing an existing chapter's pages.
 *
 * The assertions that matter are not "the order changed" — they are the ones that check the
 * edit still holds *after a reprocessing run*. That is the failure this module exists to
 * prevent: an edit applied to the derived rows alone looks right immediately and is undone
 * later by `watermark.reapply` or a retry, with nothing to connect the two.
 *
 * `reprocess` below stands in for that: it throws away `results` and rebuilds them from the
 * sources, exactly as a real run does. Every edit is asserted before and after it.
 */

interface Src {
  idx: number
  key: string
}

type Plan = PagePlan<Src, string>

/** Three sources; `b` is a long strip that split into three segments. */
const plan = (): Plan => ({
  sources: [
    { idx: 0, key: 'a' },
    { idx: 1, key: 'b' },
    { idx: 2, key: 'c' },
  ],
  results: { '0': ['a0'], '1': ['b0', 'b1', 'b2'], '2': ['c0'] },
  errors: {},
  dropped: [],
})

const order = (p: Plan) => flattenPages(p).map((f) => f.page)

/**
 * What a reprocessing run does: every page is regenerated from its original, so `results` is
 * rebuilt wholesale and nothing an editor wrote into it survives.
 */
const reprocess = (p: Plan): Plan => ({
  ...p,
  results: Object.fromEntries(
    p.sources.map((s) => [String(s.idx), s.key === 'b' ? ['b0', 'b1', 'b2'] : [`${s.key}0`]]),
  ),
})

describe('flattenPages', () => {
  it('numbers pages 0..n-1 across sources in index order', () => {
    expect(order(plan())).toEqual(['a0', 'b0', 'b1', 'b2', 'c0'])
    expect(flattenPages(plan()).map((f) => f.idx)).toEqual([0, 1, 2, 3, 4])
  })

  it('reads the source order, not the array order', () => {
    // The document is not required to store sources sorted; chapter-process sorts before
    // flattening and so must this.
    const p = plan()
    p.sources = [p.sources[2] as Src, p.sources[0] as Src, p.sources[1] as Src]
    expect(order(p)).toEqual(['a0', 'b0', 'b1', 'b2', 'c0'])
  })

  it('skips dropped segments', () => {
    expect(order({ ...plan(), dropped: [pageRefKey(1, 1)] })).toEqual(['a0', 'b0', 'b2', 'c0'])
  })
})

describe('reorderSources', () => {
  it('moves a source and carries its pages with it', () => {
    expect(order(reorderSources(plan(), [2, 0, 1]))).toEqual(['c0', 'a0', 'b0', 'b1', 'b2'])
  })

  it('rekeys results so pages stay with their own source', () => {
    const moved = reorderSources(plan(), [2, 0, 1])
    // `c` is now source 0; its page must have moved with it rather than staying under key 0.
    expect(moved.results?.['0']).toEqual(['c0'])
    expect(moved.results?.['2']).toEqual(['b0', 'b1', 'b2'])
  })

  it('rekeys errors alongside results', () => {
    const p: Plan = { ...plan(), errors: { '2': 'decode failed' } }
    // Without rekeying, `c`'s error would be left pointing at whatever became source 2.
    expect(reorderSources(p, [2, 0, 1]).errors).toEqual({ '0': 'decode failed' })
  })

  it('rekeys dropped entries alongside results', () => {
    const p: Plan = { ...plan(), dropped: [pageRefKey(1, 1)] }
    const moved = reorderSources(p, [2, 0, 1])
    expect(moved.dropped).toEqual([pageRefKey(2, 1)])
    expect(order(moved)).toEqual(['c0', 'a0', 'b0', 'b2'])
  })

  it('survives a reprocessing run', () => {
    const moved = reorderSources(plan(), [2, 0, 1])
    expect(order(reprocess(moved))).toEqual(order(moved))
  })

  it('refuses anything that is not a permutation', () => {
    expect(() => reorderSources(plan(), [0, 1])).toThrow(/permutation/)
    expect(() => reorderSources(plan(), [0, 0, 1])).toThrow(/permutation/)
    expect(() => reorderSources(plan(), [0, 1, 9])).toThrow(/unknown source/)
  })
})

describe('movePage', () => {
  it('moves a single-page source to the front', () => {
    expect(order(movePage(plan(), 4, 0))).toEqual(['c0', 'a0', 'b0', 'b1', 'b2'])
  })

  it('moves a split source as one block, from any of its segments', () => {
    // Dragging the middle segment of a strip moves the whole strip: the segments are
    // regenerated together from one original and cannot be separated durably.
    expect(order(movePage(plan(), 2, 0))).toEqual(['b0', 'b1', 'b2', 'a0', 'c0'])
  })

  it('is a no-op within one source', () => {
    expect(order(movePage(plan(), 1, 3))).toEqual(['a0', 'b0', 'b1', 'b2', 'c0'])
  })

  it('rejects an out-of-range position', () => {
    expect(() => movePage(plan(), 0, 9)).toThrow(/out of range/)
  })
})

describe('deletePages', () => {
  it('removes a whole single-page source', () => {
    const cut = deletePages(plan(), [0])
    expect(order(cut)).toEqual(['b0', 'b1', 'b2', 'c0'])
    expect(cut.sources).toHaveLength(2)
  })

  it('removes one segment of a split source and keeps the rest', () => {
    const cut = deletePages(plan(), [2])
    expect(order(cut)).toEqual(['a0', 'b0', 'b2', 'c0'])
    expect(cut.sources).toHaveLength(3)
  })

  it('keeps a deleted segment deleted through a reprocessing run', () => {
    // The whole point. `results` is rebuilt by the run; `dropped` is what makes the deletion
    // outlive it.
    const cut = deletePages(plan(), [2])
    expect(order(reprocess(cut))).toEqual(['a0', 'b0', 'b2', 'c0'])
  })

  it('drops the source once its last segment goes', () => {
    const cut = deletePages(plan(), [1, 2, 3])
    expect(order(cut)).toEqual(['a0', 'c0'])
    expect(cut.sources.map((s) => s.key)).toEqual(['a', 'c'])
    // And the run cannot bring it back, because it is no longer processed at all.
    expect(order(reprocess(cut))).toEqual(['a0', 'c0'])
  })

  it('deletes several positions at once without shifting under itself', () => {
    // Positions refer to the state before the call, so deleting 0 and 4 must not be read as
    // "delete 0, then delete whatever is at 4 afterwards".
    expect(order(deletePages(plan(), [0, 4]))).toEqual(['b0', 'b1', 'b2'])
  })

  it('keeps a source that has not produced pages yet', () => {
    // A pending or failed upload has no pages to delete; sweeping it away would discard it.
    const p: Plan = { ...plan(), sources: [...plan().sources, { idx: 3, key: 'd' }] }
    expect(deletePages(p, [0]).sources.map((s) => s.key)).toEqual(['b', 'c', 'd'])
  })

  it('rejects an out-of-range position', () => {
    expect(() => deletePages(plan(), [9])).toThrow(/out of range/)
  })
})

describe('edits compose', () => {
  it('survives reorder, delete and a reprocessing run together', () => {
    let p: Plan = plan()
    p = movePage(p, 4, 0) // c first
    p = deletePages(p, [2]) // drop b's first segment
    expect(order(p)).toEqual(['c0', 'a0', 'b1', 'b2'])
    expect(order(reprocess(p))).toEqual(['c0', 'a0', 'b1', 'b2'])
  })
})
