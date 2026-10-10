import { getEnv } from '@palscans/core/env'
import { GalleryError, resolveGallery } from '@palscans/core/gallery'
import { galleryPreviewSchema } from '@/components/admin/schemas'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * POST /api/admin/chapters/import/preview — what is in this gallery?
 *
 * Writes nothing. The point is that a bad link fails here, in front of the operator, instead
 * of creating a draft chapter that then fails in a worker thirty seconds later and has to be
 * cleaned up by hand. It also means the page count is on screen before anyone commits to it,
 * which is the difference between importing chapter 12 and importing someone's photo album.
 *
 * Only the thumbnails and the count cross the wire — the images themselves are downloaded by
 * the worker, never proxied through here.
 */
export const POST = withPermission('chapter.create', async (request) => {
  const parsed = await parseJson(request, galleryPreviewSchema)
  if (!parsed.ok) return parsed.response
  try {
    const post = await resolveGallery(parsed.data.url, { token: getEnv().IMGCHEST_TOKEN })
    return ok({
      provider: post.provider,
      id: post.id,
      title: post.title,
      nsfw: post.nsfw,
      count: post.images.length,
      images: post.images.map((image) => image.link),
    })
  } catch (error) {
    if (error instanceof GalleryError)
      return fail(error.code === 'not_found' ? 404 : 400, error.code, error.message)
    throw error
  }
})
