import type { PageVariantUrl, ReaderPage, ReaderQuality } from './types'

/**
 * Pick the width variant to serve (docs/06 settings sheet: quality → the width variant).
 * `auto` takes the smallest encode at or above the rendered width × DPR (capped at 2, the
 * point past which page art stops gaining anything); `high` the largest; `saver` the
 * smallest. Without variants the original object is served.
 */
export const pickVariant = (
  page: ReaderPage,
  quality: ReaderQuality,
  renderedWidth: number,
  dpr = 1,
): string => {
  const variants = page.variants
  if (variants.length === 0) return page.url
  const sorted = [...variants].sort((a, b) => a.w - b.w)
  if (quality === 'high') return largest(sorted).url
  if (quality === 'saver') return (sorted[0] ?? largest(sorted)).url
  const target = Math.ceil(Math.max(1, renderedWidth) * Math.min(2, Math.max(1, dpr)))
  const fit = sorted.find((v) => v.w >= target)
  return (fit ?? largest(sorted)).url
}

const largest = (sorted: PageVariantUrl[]): PageVariantUrl =>
  sorted[sorted.length - 1] as PageVariantUrl
