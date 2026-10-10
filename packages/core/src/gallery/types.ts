/**
 * Importing a chapter from an image-host gallery.
 *
 * One provider today (ImgChest), but the shape is a provider's worth rather than ImgChest's:
 * every host of this kind answers the same two questions — what is in this gallery, and what
 * is the direct URL of each image in order — and the rest of the pipeline only wants that
 * answer. Adding imgbox later is a parser and a host allowlist, not a second import path.
 */

export type GalleryProvider = 'imgchest' | 'imgur' | 'direct'

export interface GalleryImage {
  /** The provider's own id, carried into the audit record so a page is traceable upstream. */
  id: string
  /** Direct URL of the full-size original. Validated against the provider's host allowlist. */
  link: string
  /** 1-based position as the provider reports it. */
  position: number
}

export interface GalleryPost {
  provider: GalleryProvider
  /** The gallery id, not ours — `na7kjb9bq48`. */
  id: string
  title: string | null
  /** Surfaced in the preview so an operator is not shown a wall of unexpected images. */
  nsfw: boolean
  images: GalleryImage[]
}

/**
 * Why a gallery could not be turned into a page list.
 *
 * Every code is something an operator can act on, which is the point of having codes at all:
 * `not_found` means check the link, `rate_limited` means wait, `unparseable` means the host
 * changed its page and we have a bug. A single "import failed" string sent all three to the
 * same shrug.
 */
export type GalleryErrorCode =
  | 'bad_url'
  | 'not_found'
  | 'empty'
  | 'rate_limited'
  | 'unavailable'
  | 'unparseable'
  | 'bad_image_host'
  | 'too_many'
  | 'too_large'
  | 'not_an_image'

export class GalleryError extends Error {
  constructor(
    readonly code: GalleryErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'GalleryError'
  }
}

/** Hard ceiling on a single import, matching `MAX_PAGES_PER_CHAPTER` in the upload path. */
export const MAX_GALLERY_IMAGES = 400
