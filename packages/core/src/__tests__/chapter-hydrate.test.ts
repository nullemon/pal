import { describe, expect, it } from 'vitest'
import {
  deletePages,
  flattenPages,
  hydrateResults,
  type PagePlan,
  reorderSources,
} from '../chapters/pages.js'

/**
 * Rebuilding `results` for a chapter that finished processing.
 *
 * A successful run used to strip `results` from the document, and the page editor is built
 * from nothing else — so it showed "0 pages" for every chapter that had ever worked. This
 * is the function that gives those chapters their grid back, from the rows they produced.
 *
 * It is strict on purpose, and most of these assert a refusal. A Save in the editor deletes
 * a chapter's rows and reinserts what the document implies; hydrating from a guess would
 * therefore put pages in the wrong order on the live site, which is a worse outcome than a
 * panel that says it cannot edit this chapter. Every case that returns a plan also has to
 * round-trip: flattening the result must give back exactly the rows that went in.
 */

interface Src {
  idx: number
  key: string
}
interface Page {
  key: string
}
type Plan = PagePlan<Src, Page>

const src = (idx: number): Src => ({ idx, key: `uploads/1/1/${idx}.png` })
/** A page named the way the encode names it: `source.idx * 10 + segment`. */
const page = (sourceIdx: number, segment = 0): Page => ({
  key: `pages/1/1/${String(sourceIdx * 10 + segment).padStart(4, '0')}-abc${sourceIdx}${segment}.720.webp`,
})
const keys = (plan: Plan) => flattenPages(plan).map((f) => f.page.key)

describe('hydrateResults', () => {
  it('rebuilds the grid for a finished chapter — the case that showed "0 pages"', () => {
    const rows = [page(0), page(1), page(2)]
    const lean: Plan = { sources: [src(0), src(1), src(2)], results: undefined }
    const out = hydrateResults(lean, rows)
    expect(out).not.toBeNull()
    expect(keys(out as Plan)).toEqual(rows.map((r) => r.key))
  })

  it('leaves a document that still has results alone', () => {
    const plan: Plan = { sources: [src(0)], results: { '0': [page(0)] } }
    expect(hydrateResults(plan, [page(0)])).toBe(plan)
  })

  it('keeps a long strip together as one source with several segments', () => {
    // One upload cut into three pages, between two ordinary ones.
    const rows = [page(0), page(1, 0), page(1, 1), page(1, 2), page(2)]
    const out = hydrateResults({ sources: [src(0), src(1), src(2)] }, rows) as Plan
    expect(out.results?.['1']).toHaveLength(3)
    expect(flattenPages(out).map((f) => [f.source.idx, f.segment])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
    ])
  })

  it('respects a segment the operator deleted', () => {
    // Segment 1 of the strip was dropped, so its row is gone and must stay gone.
    const rows = [page(0), page(1, 0), page(1, 2)]
    const out = hydrateResults({ sources: [src(0), src(1)], dropped: ['1:1'] }, rows) as Plan
    expect(keys(out)).toEqual(rows.map((r) => r.key))
  })

  it('refuses a gap that no deletion explains', () => {
    const rows = [page(0), page(1, 0), page(1, 2)]
    expect(hydrateResults({ sources: [src(0), src(1)] }, rows)).toBeNull()
  })

  it('falls back to position when the keys describe an older arrangement', () => {
    /*
     * Sources reordered and then renumbered, pages not re-encoded: the keys still carry the
     * numbers they were encoded under, which now run backwards. They cannot be trusted, but
     * with one page per source and nothing dropped the n-th row is the n-th source.
     */
    const rows = [page(2), page(0), page(1)]
    const out = hydrateResults({ sources: [src(0), src(1), src(2)] }, rows) as Plan
    expect(keys(out)).toEqual(rows.map((r) => r.key))
    expect(out.results?.['0']?.[0]).toBe(rows[0])
  })

  it('refuses when neither the keys nor the positions can be trusted', () => {
    // Out-of-order keys *and* a row count that does not match the sources: a strip is in
    // here somewhere and there is no telling where.
    const rows = [page(2), page(0, 0), page(0, 1), page(1)]
    expect(hydrateResults({ sources: [src(0), src(1), src(2)] }, rows)).toBeNull()
  })

  it('refuses a row that names a source the document does not have', () => {
    expect(hydrateResults({ sources: [src(0)] }, [page(0), page(7)])).toBeNull()
  })

  it('refuses a key that was not written by the encode', () => {
    // A remote page, or one replaced in place: no `NNNN-` prefix, and two rows for one
    // source, so position cannot rescue it either.
    const rows = [{ key: 'remote:deadbeef.png' }, { key: 'remote:cafebabe.png' }]
    expect(hydrateResults({ sources: [src(0)] }, rows)).toBeNull()
  })

  it('hands the editor a document its edits actually work on', () => {
    // The point of all this: a reorder and a delete on a hydrated chapter behave as they
    // would have if the results had never been stripped.
    const rows = [page(0), page(1), page(2), page(3)]
    const hydrated = hydrateResults({ sources: [0, 1, 2, 3].map(src) }, rows) as Plan
    const moved = reorderSources(hydrated, [3, 0, 1, 2])
    expect(keys(moved)).toEqual([rows[3], rows[0], rows[1], rows[2]].map((r) => r?.key))
    const fewer = deletePages(moved, [1])
    expect(keys(fewer)).toEqual([rows[3], rows[1], rows[2]].map((r) => r?.key))
  })

  it('has nothing to do for a chapter with no rows', () => {
    const plan: Plan = { sources: [src(0)] }
    expect(hydrateResults(plan, [])).toBe(plan)
  })
})
