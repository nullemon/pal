import { GalleryError, type GalleryImage, type GalleryPost, MAX_GALLERY_IMAGES } from './types.js'

/**
 * Imgur albums — https://imgur.com/a/<id>.
 *
 * Added because real Cubari manifests are almost entirely Imgur: of 210 chapters across the
 * eleven published manifests I checked, every single group pointed at
 * `/proxy/api/imgur/chapter/<id>/`. A manifest importer without Imgur would have been an
 * importer that could not read the files people actually have.
 *
 * The endpoint and the URL shape are gallery-dl's, which has carried them for years:
 * `GET api.imgur.com/post/v1/albums/<id>?include=media` with a `Client-ID` header, and each
 * item becomes `https://i.imgur.com/<id>.<ext>`.
 */

/** Album and gallery ids are 5 or 7 word characters; a slug may precede them. */
export const IMGUR_ID = /^[A-Za-z0-9]{5}(?:[A-Za-z0-9]{2})?$/

/**
 * Imgur's own public web client id, as used by gallery-dl.
 *
 * Not a secret and not ours: it is the id Imgur's website sends, which is why it works
 * without registration. `IMGUR_CLIENT_ID` overrides it for anyone who would rather use
 * their own and carry their own rate limit.
 */
export const IMGUR_PUBLIC_CLIENT_ID = '546c25a59c58ad7'

export const isImgurHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'imgur.com' || host.endsWith('.imgur.com')
}

/**
 * The album id from a pasted link, a Cubari proxy path, or a bare id.
 *
 * `/a/<id>` is an album and `/gallery/<id>` is a gallery post, which for our purposes is the
 * same thing — both resolve through the albums endpoint, and a gallery that turns out not to
 * be an album simply has one image.
 */
export const parseImgurId = (input: string): string | null => {
  const raw = input.trim()
  if (!raw) return null
  if (IMGUR_ID.test(raw)) return raw
  // The form inside a Cubari manifest: /proxy/api/imgur/chapter/<id>/
  const proxied = /^\/proxy\/api\/imgur\/chapter\/([A-Za-z0-9]+)\/?$/.exec(raw)
  if (proxied?.[1] && IMGUR_ID.test(proxied[1])) return proxied[1]
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!isImgurHost(url.hostname)) return null
  // A slug may sit in front of the id: /a/some-title-aBcDeFg
  const match = /^\/(?:a|gallery|t\/[^/]+)\/(?:[^/?#]*-)?([A-Za-z0-9]{5,7})(?:[/?#]|$)/.exec(
    url.pathname,
  )
  const id = match?.[1]
  return id && IMGUR_ID.test(id) ? id : null
}

export const imgurAlbumUrl = (id: string): string => `https://imgur.com/a/${id}`

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/**
 * One media item to a page URL.
 *
 * Imgur reports `jpeg` where the file is served as `.jpg`, and animated GIFs are also
 * available as mp4 — which we never want, because a chapter page is a still image and
 * handing the pipeline a video would fail further downstream with a much worse message.
 */
const mediaUrl = (item: Record<string, unknown>): string | null => {
  const id = item.id
  if (typeof id !== 'string' || id === '') return null
  const raw = typeof item.ext === 'string' && item.ext !== '' ? item.ext : 'jpg'
  const ext = raw === 'jpeg' ? 'jpg' : raw
  if (!['jpg', 'png', 'webp', 'gif', 'avif'].includes(ext)) return null
  return `https://i.imgur.com/${id}.${ext}`
}

/** Parse `GET /post/v1/albums/<id>?include=media`. */
export const parseImgurAlbum = (body: unknown, id: string): GalleryPost => {
  const album = asRecord(body)
  if (!album) throw new GalleryError('unparseable', 'album is not an object')
  // A single-image gallery answers with `media` holding one entry; the shape is the same.
  const media = album.media
  if (!Array.isArray(media)) throw new GalleryError('unparseable', 'no media array')
  if (media.length === 0) throw new GalleryError('empty')
  if (media.length > MAX_GALLERY_IMAGES)
    throw new GalleryError('too_many', `${media.length} images`)

  const images: GalleryImage[] = []
  for (const [i, entry] of media.entries()) {
    const item = asRecord(entry)
    if (!item) throw new GalleryError('unparseable', `media ${i} is not an object`)
    const link = mediaUrl(item)
    // A refusal, not a skip: Imgur albums can carry video, and a chapter silently missing
    // the page that happened to be a gif is the failure nobody notices until a reader does.
    if (!link) throw new GalleryError('not_an_image', `media ${i} is not a still image`)
    images.push({ id: String(item.id), link, position: i + 1 })
  }
  return {
    provider: 'imgur',
    id: typeof album.id === 'string' && album.id !== '' ? album.id : id,
    title: typeof album.title === 'string' && album.title.trim() !== '' ? album.title.trim() : null,
    // Imgur marks maturity per post rather than per image.
    nsfw: album.is_mature === true || album.nsfw === true,
    images,
  }
}
