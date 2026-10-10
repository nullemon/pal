import { type ImageType, sniffImage } from '../images.js'
import {
  imgchestUrl,
  isImgchestHost,
  parseImgchestApi,
  parseImgchestId,
  parseImgchestPage,
} from './imgchest.js'
import { GalleryError, type GalleryPost } from './types.js'

/**
 * The network half of the gallery import.
 *
 * Kept apart from the parsers so the parsing is testable without a server and this file
 * stays small enough to audit, because it is the part that makes outbound requests to a
 * host named by whoever pasted the link.
 */

/** A gallery page is a few hundred KB of HTML; anything much larger is not a gallery page. */
const MAX_PAGE_BYTES = 4 * 1024 * 1024
const PAGE_TIMEOUT_MS = 20_000
const IMAGE_TIMEOUT_MS = 60_000

/**
 * A browser-ish User-Agent.
 *
 * Not cloaking: ImgChest serves the gallery page to anyone, but a request with no
 * User-Agent at all gets a challenge page from their edge, which parses as `unparseable`
 * and reads to an operator as "the import is broken".
 */
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export interface GalleryFetchOptions {
  /** Optional ImgChest personal access token. Absent is the normal case. */
  token?: string | null
  /** Injected in tests; defaults to the platform fetch. */
  fetchImpl?: typeof globalThis.fetch
}

type Fetcher = typeof globalThis.fetch

const fetcher = (opts: GalleryFetchOptions): Fetcher => opts.fetchImpl ?? globalThis.fetch

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
 * Fetch a URL that must stay on ImgChest.
 *
 * Redirects are followed but the *final* URL is re-checked, which is the part that is easy to
 * leave out: an allowlist applied only to the URL we send is defeated by a 302 to anywhere,
 * and the body of that anywhere would come back as a chapter page.
 */
const fetchOnHost = async (
  url: string,
  init: RequestInit,
  impl: Fetcher,
  timeoutMs: number,
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
    const reason = error instanceof Error ? error.message : 'request failed'
    throw new GalleryError('unavailable', reason)
  }
  // `response.url` is the URL after redirects. It can be empty in some test doubles, in
  // which case the only thing we checked is the URL we sent — which we built ourselves.
  if (response.url && !isImgchestHost(new URL(response.url).hostname))
    throw new GalleryError('bad_image_host', new URL(response.url).hostname)
  if (response.status === 404) throw new GalleryError('not_found', url)
  if (response.status === 429) throw new GalleryError('rate_limited')
  if (!response.ok) throw new GalleryError('unavailable', `HTTP ${response.status}`)
  return response
}

/**
 * Resolve a pasted link into an ordered page list.
 *
 * With no token this reads the gallery page, which needs no credential — the reason this
 * feature costs nothing to run. With a token the documented API is tried first and the page
 * is the fallback, so a markup change degrades to a slower path instead of an outage. A
 * token failure deliberately falls through rather than aborting: an expired token should not
 * break imports that would work without it.
 */
export const resolveGallery = async (
  input: string,
  opts: GalleryFetchOptions = {},
): Promise<GalleryPost> => {
  const id = parseImgchestId(input)
  if (!id) throw new GalleryError('bad_url', input.slice(0, 120))
  const impl = fetcher(opts)

  if (opts.token) {
    try {
      const response = await fetchOnHost(
        `https://api.imgchest.com/v1/post/${id}`,
        { headers: { authorization: `Bearer ${opts.token}`, accept: 'application/json' } },
        impl,
        PAGE_TIMEOUT_MS,
      )
      return parseImgchestApi(await response.json(), id)
    } catch (error) {
      // A gallery that genuinely does not exist is not worth a second request.
      if (error instanceof GalleryError && error.code === 'not_found') throw error
    }
  }

  const response = await fetchOnHost(
    imgchestUrl(id),
    { headers: { accept: 'text/html' } },
    impl,
    PAGE_TIMEOUT_MS,
  )
  const html = new TextDecoder().decode(await readCapped(response, MAX_PAGE_BYTES))
  return parseImgchestPage(html, id)
}

export interface DownloadedImage {
  bytes: Uint8Array
  type: ImageType
}

/**
 * Download one gallery image.
 *
 * The type is sniffed from the bytes and the declared `Content-Type` is ignored entirely —
 * it is the remote host's claim about a file we are about to hand to `sharp` and store under
 * a content type our own CDN will serve.
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
  if (!isImgchestHost(hostname)) throw new GalleryError('bad_image_host', hostname)
  const response = await fetchOnHost(
    link,
    { headers: { accept: 'image/*' } },
    fetcher(opts),
    IMAGE_TIMEOUT_MS,
  )
  const bytes = await readCapped(response, opts.maxBytes)
  const type = sniffImage(bytes)
  if (!type) throw new GalleryError('not_an_image', `${bytes.byteLength} bytes`)
  return { bytes, type }
}
