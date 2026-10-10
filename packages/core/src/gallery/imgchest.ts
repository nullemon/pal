import { GalleryError, type GalleryImage, type GalleryPost, MAX_GALLERY_IMAGES } from './types.js'

/**
 * ImgChest galleries — https://imgchest.com/p/<id>.
 *
 * Everything here is pure: a string in, a page list out. The network lives in `fetch.ts`, so
 * the parsing that actually breaks when a third party redesigns its site is the part that is
 * exhaustively testable against saved fixtures.
 *
 * Two shapes are read, both verified against existing clients (gallery-dl's `imagechest`
 * extractor and the `imgchest-rs` models) rather than guessed:
 *
 * 1. The gallery page carries the whole post as JSON in `<div id="app" data-page="...">` —
 *    it is an Inertia app, so the server-rendered props *are* the API response. Needs no
 *    credential, which is why it is the default path.
 * 2. `GET api.imgchest.com/v1/post/<id>` with a bearer token answers `{ data: { ... } }`.
 *    Used only when a token is configured, as insurance against (1)'s markup changing.
 *
 * The two differ in exactly one way that matters: the scraped post calls the array `files`
 * and the API calls it `images`. Both carry `link` and a 1-based `position`.
 */

/** ImgChest post ids are exactly 11 alphanumerics — gallery-dl pins the same shape. */
export const IMGCHEST_ID = /^[A-Za-z0-9]{11}$/

/**
 * Is this host ImgChest's?
 *
 * The one security-relevant function in the module. Every URL we fetch server-side — the
 * gallery page and every image in it — passes through here, because "download what the
 * operator pasted" is a server-side request forgery primitive otherwise: an attacker with
 * upload rights could aim it at `169.254.169.254` or a service on localhost and read the
 * response back out of the imported chapter's pages.
 *
 * Suffix matching is done with the leading dot deliberately. `endsWith('imgchest.com')`
 * would accept `evilimgchest.com`; `endsWith('.imgchest.com')` does not. A trailing dot is
 * stripped first because `imgchest.com.` resolves identically but compares unequal.
 */
export const isImgchestHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'imgchest.com' || host.endsWith('.imgchest.com')
}

/**
 * The gallery id from anything an operator might paste: a full URL, a bare `imgchest.com/p/x`
 * with no scheme, or just the id.
 *
 * Returns null rather than throwing because the caller turns it into a field error. A URL on
 * any other host is null too — `https://evil.example/p/aaaaaaaaaaa` matches the path shape
 * and must not be accepted on that basis.
 */
export const parseImgchestId = (input: string): string | null => {
  const raw = input.trim()
  if (!raw) return null
  if (IMGCHEST_ID.test(raw)) return raw
  let url: URL
  try {
    // A bare `imgchest.com/p/x` has no scheme; anything with one keeps it so that `file:` and
    // `javascript:` reach the protocol check below instead of being silently prefixed.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  // Note `url.hostname`, not `url.host` or the raw string: it is what the fetch would
  // actually connect to, so `https://imgchest.com@evil.example/p/x` is correctly rejected.
  if (!isImgchestHost(url.hostname)) return null
  return /^\/p\/([A-Za-z0-9]{11})(?:[/?#]|$)/.exec(url.pathname)?.[1] ?? null
}

/** The canonical gallery URL for an id. We rebuild it rather than re-use what was pasted. */
export const imgchestUrl = (id: string): string => `https://imgchest.com/p/${id}`

const ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  nbsp: ' ',
}

/**
 * Undo HTML entity escaping in an attribute value.
 *
 * One pass, not several. Unescaping `&amp;` in a separate pass turns a literal `&amp;quot;`
 * into `&quot;` and then into `"`, which injects a quote into the JSON and corrupts the
 * parse; a single scan consumes `&amp;` and resumes *after* it, leaving `quot;` as text.
 */
const unescapeHtml = (value: string): string =>
  value.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, ref: string) => {
    try {
      if (ref[0] === '#') {
        const hex = ref[1] === 'x' || ref[1] === 'X'
        const code = Number.parseInt(hex ? ref.slice(2) : ref.slice(1), hex ? 16 : 10)
        // Surrogates and anything past the last plane throw from fromCodePoint.
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
        return String.fromCodePoint(code)
      }
      return ENTITIES[ref.toLowerCase()] ?? match
    } catch {
      return match
    }
  })

/**
 * Pull the `data-page` attribute out of the gallery page.
 *
 * Reading to the next `"` is safe precisely because the attribute is HTML-escaped: every
 * quote inside the JSON arrives as `&quot;`, so the first bare `"` is the attribute's own
 * closing delimiter. The single-quoted form is tried as a fallback in case their templating
 * ever switches, since getting it wrong would look like "the gallery is empty".
 */
const extractDataPage = (html: string): string | null => {
  for (const [open, close] of [
    ['data-page="', '"'],
    ["data-page='", "'"],
  ] as const) {
    const start = html.indexOf(open)
    if (start === -1) continue
    const from = start + open.length
    const end = html.indexOf(close, from)
    if (end === -1) continue
    return html.slice(from, end)
  }
  return null
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/**
 * Normalise either shape's image array into ordered pages.
 *
 * Ordering deserves a word. `position` is 1-based and authoritative when it is present and
 * unique, so it is used — but a gallery with missing or duplicated positions falls back to
 * document order rather than to a sort that would shuffle pages. A manga chapter in the
 * wrong order is a worse failure than one that trusted the array it was given.
 *
 * Off-host links abort the whole import instead of being skipped. Dropping one silently
 * would produce a chapter missing page 14 with nothing anywhere saying so.
 */
const toImages = (value: unknown): GalleryImage[] => {
  if (!Array.isArray(value)) throw new GalleryError('unparseable', 'no image array')
  if (value.length === 0) throw new GalleryError('empty')
  if (value.length > MAX_GALLERY_IMAGES)
    throw new GalleryError('too_many', `${value.length} images, limit ${MAX_GALLERY_IMAGES}`)

  const out: GalleryImage[] = []
  for (const [i, entry] of value.entries()) {
    const file = asRecord(entry)
    const link = file?.link
    if (typeof link !== 'string' || link === '')
      throw new GalleryError('unparseable', `image ${i} has no link`)
    let host: string
    try {
      const url = new URL(link)
      if (url.protocol !== 'https:' && url.protocol !== 'http:')
        throw new GalleryError('bad_image_host', link)
      host = url.hostname
    } catch (error) {
      if (error instanceof GalleryError) throw error
      throw new GalleryError('unparseable', `image ${i} has an unreadable link`)
    }
    if (!isImgchestHost(host)) throw new GalleryError('bad_image_host', host)
    const position = Number(file?.position)
    out.push({
      id: typeof file?.id === 'string' ? file.id : String(i + 1),
      link,
      position: Number.isInteger(position) && position > 0 ? position : i + 1,
    })
  }

  const positions = new Set(out.map((img) => img.position))
  if (positions.size === out.length) out.sort((a, b) => a.position - b.position)
  return out
}

/** ImgChest reports nsfw as 0/1 rather than a boolean, and `imgchest-rs` decodes it the same way. */
const toNsfw = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true'

const toTitle = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const toPost = (post: Record<string, unknown>, id: string): GalleryPost => ({
  provider: 'imgchest',
  id: typeof post.slug === 'string' && post.slug !== '' ? post.slug : id,
  title: toTitle(post.title),
  nsfw: toNsfw(post.nsfw),
  // The scraped post calls it `files`, the API calls it `images`. Same entries either way.
  images: toImages(post.files ?? post.images),
})

/**
 * Parse a gallery page's HTML.
 *
 * ImgChest answers a missing gallery with a 200 and a "Not Found" page rather than a 404, so
 * the title check is the only way to tell "no such gallery" from "our parser broke" — a
 * distinction worth keeping, because one is the operator's typo and the other is our bug.
 */
export const parseImgchestPage = (html: string, id: string): GalleryPost => {
  const raw = extractDataPage(html)
  if (raw === null) {
    if (/<title>\s*Not Found\s*<\/title>/i.test(html)) throw new GalleryError('not_found', id)
    throw new GalleryError('unparseable', 'no data-page attribute')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(unescapeHtml(raw))
  } catch {
    throw new GalleryError('unparseable', 'data-page is not JSON')
  }
  const post = asRecord(asRecord(asRecord(parsed)?.props)?.post)
  if (!post) throw new GalleryError('not_found', id)
  return toPost(post, id)
}

/** Parse `GET /v1/post/<id>`, which wraps the post in `{ data }`. */
export const parseImgchestApi = (body: unknown, id: string): GalleryPost => {
  const post = asRecord(asRecord(body)?.data)
  if (!post) throw new GalleryError('unparseable', 'no data object')
  return toPost(post, id)
}
