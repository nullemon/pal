import { getEnv } from '@/lib/env'
import { cachedCard, cardCacheControl, notModified } from './og-cache'
import { OG_HEIGHT, OG_WIDTH } from './og-card'
import { type OgSeriesRow, seriesCardText, seriesCardVersion } from './og-data'
import { loadCoverDataUri, renderOgCard } from './og-render'

/**
 * The shared body of `/api/og/series/*` and `/api/og/chapter/*`: render once per card,
 * answer repeat crawler hits from the LRU or with a 304, and never let an unknown slug reach
 * the rasteriser. A missing series is a 404, not a generic card — a card for something that
 * does not exist is worse than no preview, because crawlers cache it.
 */

const PNG_HEADERS = {
  'content-type': 'image/png',
  'x-content-type-options': 'nosniff',
  // Built from public catalogue data only, so any origin may embed it.
  'access-control-allow-origin': '*',
} as const

export const ogNotFound = (): Response =>
  Response.json(
    { error: 'not_found' },
    { status: 404, headers: { 'cache-control': 'public, max-age=60' } },
  )

export interface OgCardRequest {
  request: Request
  row: OgSeriesRow
  /** Formatted chapter number ("12.5"), or null for the series card. */
  chapter: string | null
  /** The `?v=` the caller sent; it decides how hard the response may be cached. */
  version: string | null
}

export const ogCardResponse = async ({
  request,
  row,
  chapter,
  version,
}: OgCardRequest): Promise<Response> => {
  const current = seriesCardVersion(row, chapter)
  const key = `${row.slug}|${chapter ?? ''}|${current}`
  const card = await cachedCard(key, async () => {
    const coverDataUri = await loadCoverDataUri(row.coverKey)
    return renderOgCard({
      ...seriesCardText(row, chapter),
      coverDataUri,
      tint: row.coverColor,
      siteName: getEnv().SITE_NAME,
    })
  })

  const headers = new Headers({
    ...PNG_HEADERS,
    etag: card.etag,
    'cache-control': cardCacheControl(version === current),
  })
  if (notModified(request, card.etag)) return new Response(null, { status: 304, headers })

  headers.set('content-length', String(card.bytes.byteLength))
  headers.set('x-og-size', `${OG_WIDTH}x${OG_HEIGHT}`)
  return new Response(card.bytes as unknown as BodyInit, { status: 200, headers })
}
