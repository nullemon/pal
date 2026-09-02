import type { ReaderMode } from './types'

/**
 * What the reader walks through, in order: pages, the mobile in-strip ad after every N
 * pages (an ad *page* in paged mode), and the end-of-chapter panel. Both modes share one
 * sequence so switching keeps the reader's place.
 */
export type ReaderItem = { kind: 'page'; idx: number } | { kind: 'ad'; n: number } | { kind: 'end' }

export interface SequenceOptions {
  pageCount: number
  /** 0 = no in-strip ads. */
  interval: number
  /** In-strip ads are a mobile placement (docs/06). */
  mobile: boolean
  adsEnabled: boolean
}

export const buildSequence = (o: SequenceOptions): ReaderItem[] => {
  const items: ReaderItem[] = []
  const every = o.adsEnabled && o.mobile && o.interval > 0 ? o.interval : 0
  let ads = 0
  for (let idx = 0; idx < o.pageCount; idx++) {
    items.push({ kind: 'page', idx })
    const isLast = idx === o.pageCount - 1
    if (every && !isLast && (idx + 1) % every === 0) items.push({ kind: 'ad', n: ++ads })
  }
  items.push({ kind: 'end' })
  return items
}

/** Item index of a page; the end panel for anything past the last page. */
export const itemIndexOfPage = (items: ReaderItem[], pageIdx: number): number => {
  const i = items.findIndex((it) => it.kind === 'page' && it.idx === pageIdx)
  return i >= 0 ? i : items.length - 1
}

/** The page a reader is "on" for a given item (the previous page for an ad or the end). */
export const pageOfItem = (items: ReaderItem[], itemIndex: number): number => {
  for (let i = Math.min(itemIndex, items.length - 1); i >= 0; i--) {
    const it = items[i]
    if (it?.kind === 'page') return it.idx
  }
  return 0
}

/**
 * Which items a paged view shows at `itemIndex`: one, or a spread of two consecutive pages
 * in double-page mode (never an ad or the end panel, and the first page stays alone as a
 * cover the way print books open).
 */
export const spreadAt = (items: ReaderItem[], itemIndex: number, mode: ReaderMode): number[] => {
  const cur = items[itemIndex]
  if (!cur || mode !== 'double' || cur.kind !== 'page' || cur.idx === 0) return [itemIndex]
  if (items[itemIndex + 1]?.kind !== 'page') return [itemIndex]
  // Pair pages (1,2), (3,4)… so spreads are stable however the reader arrived here.
  if (cur.idx % 2 === 1) return [itemIndex, itemIndex + 1]
  return [itemIndex]
}

/** The item to land on after "next" from `itemIndex` (skips the spread partner). */
export const nextItemIndex = (items: ReaderItem[], itemIndex: number, mode: ReaderMode): number => {
  const shown = spreadAt(items, itemIndex, mode)
  const last = shown[shown.length - 1] ?? itemIndex
  return Math.min(items.length - 1, last + 1)
}

export const prevItemIndex = (items: ReaderItem[], itemIndex: number, mode: ReaderMode): number => {
  const target = Math.max(0, itemIndex - 1)
  // Land on the start of the spread that contains `target`.
  const it = items[target]
  if (mode === 'double' && it?.kind === 'page' && it.idx > 0 && it.idx % 2 === 0) {
    if (items[target - 1]?.kind === 'page') return target - 1
  }
  return target
}

/** 0..1 of the chapter read, by page position. */
export const progressOfPage = (pageIdx: number, pageCount: number): number =>
  pageCount <= 0 ? 0 : Math.min(1, (pageIdx + 1) / pageCount)
