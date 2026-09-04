import type { ReaderData, ReaderPage } from '@/components/reader/types'

/** "48.2 MB" — decimal units, because that is what a phone's storage screen shows. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1000) return `${Math.round(bytes)} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let i = 0
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000
    i += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

/** Largest encode available: a download is read on whatever screen the reader has later. */
export const bestUrl = (page: ReaderPage): string => {
  if (page.variants.length === 0) return page.url
  return page.variants.reduce((a, b) => (b.w > a.w ? b : a)).url
}

/**
 * Rewrite the payload so every page points at the one variant that was cached. The reader
 * picks a variant from `quality` and the rendered width; offline there is only one encode,
 * and `pickVariant` must return it whatever the reader's settings say.
 */
export const pinToCachedVariant = (data: ReaderData): ReaderData => ({
  ...data,
  pages: data.pages.map((p) => {
    const url = bestUrl(p)
    const variant = p.variants.find((v) => v.url === url)
    return { ...p, url, variants: variant ? [variant] : [] }
  }),
  // Offline there is no next chapter to prefetch.
  nextPagesEndpoint: null,
})
