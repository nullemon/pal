import { CREDIT_HEIGHT, CREDIT_WIDTH } from '@/lib/credit/layout'
import type { ReaderPage } from '../types'

/**
 * Put the credit card into a chapter's pages (docs/03).
 *
 * At read time rather than at upload time, and that is the whole design. The card's contents
 * change when an operator edits a handle or a note, and a card baked into `chapter_pages`
 * would mean rewriting every chapter to fix a typo. Inserting here means the chapter's own
 * pages are never touched: the uploaded twenty stay twenty, and the reader sees twenty-one.
 *
 * It also means the feature can be switched off and every chapter is exactly as it was.
 */

/**
 * The index the card takes: second page, or last in a chapter too short to have one.
 *
 * Second rather than first because the cover is what every thumbnail, every share and every
 * series page shows. Pushing it behind a credit card would change what the chapter looks
 * like everywhere it is linked, which is a much bigger change than it appears.
 */
export const creditInsertAt = (pageCount: number): number | null =>
  pageCount <= 0 ? null : Math.min(1, pageCount)

/**
 * `pages` with the card spliced in, renumbered so the page counter reads 1…n+1.
 *
 * Renumbering is safe because each page's `url` is already resolved by the time this runs —
 * a remote page's `/p/:chapter/:idx` was built from its *original* index and is carried as a
 * string, so moving the page in the list cannot break the URL it points at. That is worth
 * saying out loud: renumbering before the URLs were built would silently serve page 4's
 * image for page 5.
 */
export const withCreditPage = (pages: readonly ReaderPage[], chapterId: number): ReaderPage[] => {
  const at = creditInsertAt(pages.length)
  if (at === null) return [...pages]
  const card: ReaderPage = {
    idx: at,
    // The reader lays out from these before the image arrives, so they only need the right
    // *shape* — the card is landscape, and claiming it square would reserve a tall gap and
    // then jump when it loads.
    width: CREDIT_WIDTH,
    height: CREDIT_HEIGHT,
    blurHash: null,
    url: `/credit/${chapterId}`,
    variants: [],
  }
  const out = [...pages.slice(0, at), card, ...pages.slice(at)]
  return out.map((page, idx) => (page.idx === idx ? page : { ...page, idx }))
}
