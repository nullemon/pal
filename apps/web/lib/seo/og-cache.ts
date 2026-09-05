/**
 * Cache in front of the card rasteriser. A crawler unfurl is not one request: Discord,
 * Telegram and X each fetch the image, often several times, and a popular chapter link
 * pasted into a busy server arrives as a burst. Rasterising per hit would be a
 * denial-of-service the site inflicts on itself, so:
 *
 *  1. identical in-flight renders share one promise (single flight), and
 *  2. finished cards stay in a small process-local LRU,
 *
 * on top of the `Cache-Control` + `ETag` the route sends, which is what keeps the CDN and
 * the crawlers themselves from coming back at all.
 */

export interface CachedCard {
  bytes: Uint8Array
  etag: string
}

/** ~120 KB a card; 48 entries is a few MB and covers the links a raid actually shares. */
const MAX_ENTRIES = 48

const done = new Map<string, CachedCard>()
const inFlight = new Map<string, Promise<CachedCard>>()

const touch = (key: string, value: CachedCard) => {
  done.delete(key)
  done.set(key, value)
  while (done.size > MAX_ENTRIES) {
    const oldest = done.keys().next()
    if (oldest.done) break
    done.delete(oldest.value)
  }
}

export const cardEtag = (key: string, byteLength: number): string => `W/"og-${key}-${byteLength}"`

/**
 * The card for `key`, rendered at most once per key no matter how many requests race.
 * A failed render is not cached — the next request retries.
 */
export const cachedCard = async (
  key: string,
  render: () => Promise<Uint8Array>,
): Promise<CachedCard> => {
  const hit = done.get(key)
  if (hit) {
    touch(key, hit)
    return hit
  }
  const running = inFlight.get(key)
  if (running) return running

  const promise = (async () => {
    const bytes = await render()
    const value: CachedCard = { bytes, etag: cardEtag(key, bytes.byteLength) }
    touch(key, value)
    return value
  })()
  inFlight.set(key, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(key)
  }
}

/** Test seam. */
export const clearCardCache = (): void => {
  done.clear()
  inFlight.clear()
}

export const cardCacheSize = (): number => done.size

/**
 * A card is derived entirely from its `?v=` fingerprint, so it can be cached hard. Without
 * the fingerprint (a hand-typed URL, or a crawler that dropped the query) the same bytes are
 * served but only for an hour, so a cover change is picked up without a purge.
 */
export const cardCacheControl = (versioned: boolean): string =>
  versioned
    ? 'public, max-age=31536000, s-maxage=31536000, immutable'
    : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

/** 304 when the crawler already holds this exact card. */
export const notModified = (request: Request, etag: string): boolean => {
  const header = request.headers.get('if-none-match')
  if (!header) return false
  return header
    .split(',')
    .map((t) => t.trim())
    .some((t) => t === etag || t === '*')
}
