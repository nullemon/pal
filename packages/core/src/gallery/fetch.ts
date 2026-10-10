import { type ImageType, sniffImage } from '../images.js'
import { isBlockedHostname } from './address.js'
import {
  imgchestUrl,
  isImgchestHost,
  parseImgchestApi,
  parseImgchestId,
  parseImgchestPage,
} from './imgchest.js'
import {
  IMGUR_PUBLIC_CLIENT_ID,
  imgurAlbumUrl,
  isImgurHost,
  parseImgurAlbum,
  parseImgurId,
} from './imgur.js'
import { type Manifest, manifestRawUrl, parseManifest } from './manifest.js'
import { GalleryError, type GalleryPost } from './types.js'

/**
 * The network half of the gallery import.
 *
 * Kept apart from the parsers so the parsing is testable without a server, and so this file
 * stays small enough to audit: it is the part that makes outbound requests to a host named
 * by whoever pasted the link.
 *
 * Two different guards apply, deliberately. Fetching a *gallery page* is locked to that
 * provider's own hosts — there is exactly one host an ImgChest gallery can live on, so
 * anything else is a mistake or an attack. Fetching an *image* can only use the weaker
 * public-address guard, because a direct URL list is allowed to name any public host; the
 * provider that produced the list has already applied whatever stronger rule it has.
 */

/** A gallery page or manifest is a few hundred KB; anything much larger is not one. */
const MAX_PAGE_BYTES = 4 * 1024 * 1024
const PAGE_TIMEOUT_MS = 20_000
const IMAGE_TIMEOUT_MS = 60_000

/**
 * A browser-ish User-Agent.
 *
 * Not cloaking: these pages are served to anyone, but a request with no User-Agent at all
 * gets a challenge page from some edges, which parses as `unparseable` and reads to an
 * operator as "the import is broken".
 */
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export interface GalleryFetchOptions {
  /** Optional ImgChest personal access token. Absent is the normal case. */
  token?: string | null
  /** Optional Imgur client id; the public web one is used when absent. */
  imgurClientId?: string | null
  /** Injected in tests; defaults to the platform fetch. */
  fetchImpl?: typeof globalThis.fetch
}

type Fetcher = typeof globalThis.fetch
type HostGuard = (hostname: string) => boolean

const fetcher = (opts: GalleryFetchOptions): Fetcher => opts.fetchImpl ?? globalThis.fetch

/** Any public address — the weakest guard, for images from an operator-supplied list. */
const publicHost: HostGuard = (hostname) => !isBlockedHostname(hostname)

/**
 * Read a response body, refusing to buffer more than `maxBytes`.
 *
 * The cap is enforced while reading, not after. `Content-Length` is checked first because it
 * is free, but it is a claim, not a fact — a hostile or misconfigured server can omit it or
 * lie, and `await response.arrayBuffer()` on a response that turns out to be 4 GB is how a
 * 2 GB worker dies. Chunks are counted as they arrive and the body is cancelled the moment
 * the total goes over.
 */
const readCapped = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new GalleryError('too_large', `${declared} bytes`)
  const body = response.body
  if (!body) throw new GalleryError('unavailable', 'empty body')
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) throw new GalleryError('too_large', `over ${maxBytes} bytes`)
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

/**
 * Fetch a URL whose host must satisfy `guard`, before and after redirects.
 *
 * The after is the part that is easy to leave out: a guard applied only to the URL we send
 * is defeated by a 302 to anywhere, and the body of that anywhere would come back as a
 * chapter page.
 */
const fetchGuarded = async (
  url: string,
  init: RequestInit,
  impl: Fetcher,
  timeoutMs: number,
  guard: HostGuard,
): Promise<Response> => {
  let response: Response
  try {
    response = await impl(url, {
      ...init,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': UA, ...(init.headers ?? {}) },
    })
  } catch (error) {
    throw new GalleryError('unavailable', error instanceof Error ? error.message : 'request failed')
  }
  // `response.url` is the URL after redirects. Some test doubles leave it empty, in which
  // case the only thing checked is the URL we sent — which we built ourselves.
  if (response.url) {
    const landed = new URL(response.url).hostname
    if (!guard(landed)) throw new GalleryError('bad_image_host', landed)
  }
  if (response.status === 404) throw new GalleryError('not_found', url)
  if (response.status === 429) throw new GalleryError('rate_limited')
  if (!response.ok) throw new GalleryError('unavailable', `HTTP ${response.status}`)
  return response
}

const textOf = async (response: Response): Promise<string> =>
  new TextDecoder().decode(await readCapped(response, MAX_PAGE_BYTES))

/**
 * ImgChest: the gallery page needs no credential, because it carries the whole post as JSON.
 * A token switches to the documented API first and keeps the page as the fallback, so a
 * markup change degrades to a slower path instead of an outage.
 */
const resolveImgchest = async (id: string, opts: GalleryFetchOptions): Promise<GalleryPost> => {
  const impl = fetcher(opts)
  if (opts.token) {
    try {
      const response = await fetchGuarded(
        `https://api.imgchest.com/v1/post/${id}`,
        { headers: { authorization: `Bearer ${opts.token}`, accept: 'application/json' } },
        impl,
        PAGE_TIMEOUT_MS,
        isImgchestHost,
      )
      return parseImgchestApi(await response.json(), id)
    } catch (error) {
      // A gallery that genuinely does not exist is not worth a second request. Anything
      // else — an expired token above all — falls through rather than breaking an import
      // that would have worked without a token at all.
      if (error instanceof GalleryError && error.code === 'not_found') throw error
    }
  }
  const response = await fetchGuarded(
    imgchestUrl(id),
    { headers: { accept: 'text/html' } },
    impl,
    PAGE_TIMEOUT_MS,
    isImgchestHost,
  )
  return parseImgchestPage(await textOf(response), id)
}

/** Imgur: the albums endpoint, with Imgur's own public web client id unless given another. */
const resolveImgur = async (id: string, opts: GalleryFetchOptions): Promise<GalleryPost> => {
  const response = await fetchGuarded(
    `https://api.imgur.com/post/v1/albums/${id}?include=media`,
    {
      headers: {
        authorization: `Client-ID ${opts.imgurClientId || IMGUR_PUBLIC_CLIENT_ID}`,
        accept: 'application/json',
      },
    },
    fetcher(opts),
    PAGE_TIMEOUT_MS,
    isImgurHost,
  )
  return parseImgurAlbum(await response.json(), id)
}

/** Resolve a gallery by provider and id, for a manifest entry that already names both. */
export const resolveGalleryById = async (
  provider: 'imgchest' | 'imgur',
  id: string,
  opts: GalleryFetchOptions = {},
): Promise<GalleryPost> =>
  provider === 'imgur' ? resolveImgur(id, opts) : resolveImgchest(id, opts)

/**
 * Resolve a pasted link into an ordered page list, whichever host it is on.
 *
 * ImgChest is tried first only because its id shape is the stricter of the two; the parsers
 * are host-checked, so the order is a detail rather than a correctness question.
 */
export const resolveGallery = async (
  input: string,
  opts: GalleryFetchOptions = {},
): Promise<GalleryPost> => {
  const chest = parseImgchestId(input)
  if (chest) return resolveImgchest(chest, opts)
  const imgur = parseImgurId(input)
  if (imgur) return resolveImgur(imgur, opts)
  throw new GalleryError('bad_url', input.slice(0, 120))
}

/** Which providers a pasted string could be, without going near the network. */
export const identifyGallery = (
  input: string,
): { provider: 'imgchest' | 'imgur'; id: string } | null => {
  const chest = parseImgchestId(input)
  if (chest) return { provider: 'imgchest', id: chest }
  const imgur = parseImgurId(input)
  if (imgur) return { provider: 'imgur', id: imgur }
  return null
}

/**
 * Fetch and parse a series manifest.
 *
 * The URL is rewritten to its raw form first, because operators paste the page they are
 * looking at and `github.com/.../blob/...` answers with HTML.
 */
export const resolveManifest = async (
  input: string,
  opts: GalleryFetchOptions & { group?: string | null } = {},
): Promise<{ url: string; manifest: Manifest }> => {
  const url = manifestRawUrl(input)
  if (!url) throw new GalleryError('bad_url', input.slice(0, 120))
  const response = await fetchGuarded(
    url,
    { headers: { accept: 'application/json, text/plain' } },
    fetcher(opts),
    PAGE_TIMEOUT_MS,
    publicHost,
  )
  const body = await textOf(response)
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new GalleryError('unparseable', 'that URL did not answer with JSON')
  }
  return { url, manifest: parseManifest(parsed, { group: opts.group ?? null }) }
}

export interface DownloadedImage {
  bytes: Uint8Array
  type: ImageType
}

/**
 * Download one page image.
 *
 * Guarded by the public-address rule rather than a per-provider allowlist: the list this URL
 * came from may legitimately name any public host, and the provider that produced it has
 * already applied whatever stronger rule it has. What is never allowed is loopback, a
 * private range, or the cloud metadata address — see ./address.ts.
 *
 * The type is sniffed from the bytes and the declared `Content-Type` is ignored entirely —
 * it is a remote host's claim about a file we are about to hand to `sharp` and then store
 * under a content type our own CDN will serve.
 */
export const downloadGalleryImage = async (
  link: string,
  opts: GalleryFetchOptions & { maxBytes: number },
): Promise<DownloadedImage> => {
  let hostname: string
  try {
    hostname = new URL(link).hostname
  } catch {
    throw new GalleryError('bad_image_host', link.slice(0, 120))
  }
  if (!publicHost(hostname)) throw new GalleryError('bad_image_host', hostname)
  const response = await fetchGuarded(
    link,
    { headers: { accept: 'image/*' } },
    fetcher(opts),
    IMAGE_TIMEOUT_MS,
    publicHost,
  )
  const bytes = await readCapped(response, opts.maxBytes)
  const type = sniffImage(bytes)
  if (!type) throw new GalleryError('not_an_image', `${bytes.byteLength} bytes`)
  return { bytes, type }
}
