import { describe, expect, it } from 'vitest'
import { creditInsertAt, withCreditPage } from './server/credit-page'
import type { ReaderPage } from './types'

/**
 * Splicing the credit card into a chapter's pages.
 *
 * Done at read time, so the chapter's own pages are never rewritten — an operator fixing a
 * typo in a handle must not mean rewriting a thousand chapters, and switching the feature
 * off must leave every chapter exactly as it was.
 *
 * The rule that needs pinning is that the *existing* pages keep pointing at their own
 * images. Their URLs were built from their original indexes and are carried as strings, so
 * renumbering for the page counter is safe — but only in that order. Renumbering before the
 * URLs were resolved would serve page 4's image as page 5.
 */

const page = (idx: number): ReaderPage => ({
  idx,
  width: 800,
  height: 1200,
  blurHash: null,
  url: `/p/42/${idx}`,
  variants: [],
})

const pages = (n: number): ReaderPage[] => Array.from({ length: n }, (_, i) => page(i))

describe('creditInsertAt', () => {
  it('is the second page of a normal chapter', () => {
    expect(creditInsertAt(20)).toBe(1)
  })

  it('goes after the only page of a one-page chapter', () => {
    expect(creditInsertAt(1)).toBe(1)
  })

  it('is nowhere in a chapter with no pages', () => {
    expect(creditInsertAt(0)).toBeNull()
  })
})

describe('withCreditPage', () => {
  it('turns twenty pages into twenty-one', () => {
    expect(withCreditPage(pages(20), 42)).toHaveLength(21)
  })

  it('puts the card second, leaving the cover first', () => {
    const out = withCreditPage(pages(20), 42)
    expect(out[0]?.url).toBe('/p/42/0')
    expect(out[1]?.url).toBe('/credit/42')
  })

  it('leaves every original page pointing at its own image', () => {
    // The load-bearing one. Renumbering must not disturb the resolved URLs.
    const out = withCreditPage(pages(5), 42)
    expect(out.map((p) => p.url)).toEqual([
      '/p/42/0',
      '/credit/42',
      '/p/42/1',
      '/p/42/2',
      '/p/42/3',
      '/p/42/4',
    ])
  })

  it('renumbers so the page counter reads 1 to n+1 without a gap', () => {
    expect(withCreditPage(pages(5), 42).map((p) => p.idx)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('adds nothing to a chapter with no pages', () => {
    expect(withCreditPage([], 42)).toEqual([])
  })

  it('appends to a one-page chapter rather than preceding its only page', () => {
    const out = withCreditPage(pages(1), 42)
    expect(out.map((p) => p.url)).toEqual(['/p/42/0', '/credit/42'])
  })

  it('does not mutate the pages it was given', () => {
    const original = pages(3)
    withCreditPage(original, 42)
    expect(original).toHaveLength(3)
    expect(original.map((p) => p.idx)).toEqual([0, 1, 2])
  })
})
