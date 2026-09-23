import {
  ANILIST_ENDPOINT,
  type AniListMedia,
  BY_ID_QUERY,
  mapMedia,
  mapSearchResults,
  SEARCH_QUERY,
  type SeriesMetadata,
} from '@palscans/core/metadata'

/**
 * Talking to AniList. The mapping lives in `@palscans/core/metadata`; this is only the
 * request, the timeout and the failure modes.
 *
 * Everything here runs server-side. The browser never calls AniList directly — partly so one
 * shared timeout and rate limit apply rather than each admin's tab having its own, and partly
 * because a cover has to be fetched by the server anyway to go through the `series.art`
 * pipeline. A hotlinked `anilist.co` URL on a series page would be someone else's bandwidth
 * and would break the day they change hosting.
 */

/** AniList is a courtesy, not a dependency: a slow answer must not hold an admin request open. */
const TIMEOUT_MS = 10_000
/** Enough to choose from without turning the picker into a browse screen. */
export const SEARCH_LIMIT = 8

export type MetadataFailure =
  | { ok: false; code: 'rate_limited'; retryAfterSec: number }
  | { ok: false; code: 'unavailable' }
  | { ok: false; code: 'not_found' }

export type MetadataResult<T> = { ok: true; data: T } | MetadataFailure

interface GraphQlResponse {
  data?: {
    Page?: { media?: readonly (AniListMedia | null)[] | null } | null
    Media?: AniListMedia | null
  } | null
  errors?: readonly { message?: string }[] | null
}

const call = async (
  query: string,
  variables: Record<string, unknown>,
): Promise<MetadataResult<GraphQlResponse['data']>> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      // Never cached: an operator pressing Look up again after fixing a typo must get a
      // fresh answer, and Next would otherwise memoise this for the request's lifetime.
      cache: 'no-store',
    })
    if (res.status === 429) {
      // AniList publishes its budget in `retry-after`; pass it through so the panel can say
      // how long rather than telling the operator to guess.
      const after = Number(res.headers.get('retry-after') ?? '60')
      return { ok: false, code: 'rate_limited', retryAfterSec: Number.isFinite(after) ? after : 60 }
    }
    if (!res.ok) return { ok: false, code: 'unavailable' }
    const body = (await res.json()) as GraphQlResponse
    // GraphQL answers 200 with an `errors` array for a bad query or a missing id.
    if (body.errors?.length && !body.data) return { ok: false, code: 'not_found' }
    return { ok: true, data: body.data ?? null }
  } catch {
    // Aborted, offline, or unparseable. All the same to the caller: no candidates today.
    return { ok: false, code: 'unavailable' }
  } finally {
    clearTimeout(timer)
  }
}

/** Candidates for a title the operator typed. Empty is a valid answer, not a failure. */
export const searchMetadata = async (
  search: string,
  perPage: number = SEARCH_LIMIT,
): Promise<MetadataResult<SeriesMetadata[]>> => {
  const term = search.trim()
  if (term.length < 2) return { ok: true, data: [] }
  const res = await call(SEARCH_QUERY, { search: term, perPage })
  if (!res.ok) return res
  return { ok: true, data: mapSearchResults(res.data?.Page?.media ?? []) }
}

/**
 * One candidate, fetched fresh by id at the moment it is applied rather than trusting the
 * copy the search returned — an operator may have left the picker open for an hour.
 */
export const metadataById = async (id: number): Promise<MetadataResult<SeriesMetadata>> => {
  const res = await call(BY_ID_QUERY, { id })
  if (!res.ok) return res
  const media = res.data?.Media
  if (!media || typeof media.id !== 'number') return { ok: false, code: 'not_found' }
  return { ok: true, data: mapMedia(media) }
}

/** What a cover may be, matching the admin art upload's own allowlist. */
const COVER_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}
/** The same ceiling the manual cover upload enforces (`MAX_ART_BYTES`). */
const MAX_COVER_BYTES = 20 * 1024 * 1024

export interface FetchedCover {
  body: Uint8Array
  contentType: string
  ext: string
}

/**
 * Download a candidate's cover so it can go through `series.art` like any uploaded one.
 *
 * Deliberately strict about what it accepts: the URL comes from a third party, so the reply
 * is checked for an image content type and the same size cap as a manual upload before any of
 * it is kept. `https` only — an http URL would be a downgrade the operator never asked for.
 */
export const fetchCover = async (url: string): Promise<FetchedCover | null> => {
  if (!url.startsWith('https://')) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) return null
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
    const ext = COVER_TYPES[contentType]
    if (!ext) return null
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > MAX_COVER_BYTES) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    // `content-length` is a claim; the body is the fact.
    if (buf.byteLength === 0 || buf.byteLength > MAX_COVER_BYTES) return null
    return { body: buf, contentType, ext }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
