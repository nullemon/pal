import { directUrlProblem } from './address.js'
import { GalleryError, type GalleryImage, type GalleryPost, MAX_GALLERY_IMAGES } from './types.js'

/**
 * A chapter from a plain list of image URLs, one per line.
 *
 * The escape hatch, and the reason it is worth having: it works with every host we will
 * never write an adapter for. Someone with a chapter on a host nobody has heard of pastes
 * the URLs and is done, instead of waiting for a provider to be added.
 *
 * Order is the order given, always. There is no `position` to trust or distrust here — the
 * operator typed the lines, so the lines are the page order, and silently sorting them would
 * be the single worst thing this function could do.
 */

/** Markdown, HTML and CSV noise people paste along with URLs. */
const STRIP = /^(?:[-*+>\s]+|\d+[.)]\s*)|[,;"'()<>[\]]+$/g

const clean = (line: string): string => line.trim().replace(STRIP, '').trim()

export const parseDirectList = (input: string): GalleryPost => {
  const lines = input
    .split(/[\r\n]+/)
    .map(clean)
    .filter((line) => line !== '')
  if (lines.length === 0) throw new GalleryError('empty')
  if (lines.length > MAX_GALLERY_IMAGES)
    throw new GalleryError('too_many', `${lines.length} URLs, limit ${MAX_GALLERY_IMAGES}`)

  const images: GalleryImage[] = []
  const seen = new Set<string>()
  for (const [i, line] of lines.entries()) {
    const problem = directUrlProblem(line)
    if (problem)
      throw new GalleryError(
        problem === 'host' ? 'bad_image_host' : 'bad_url',
        `line ${i + 1}: ${line.slice(0, 80)}`,
      )
    /**
     * A repeated URL is refused rather than deduplicated.
     *
     * It is nearly always a paste that went wrong — a line duplicated, or a page number
     * typed twice — and the two plausible intentions (the same image twice on purpose, or a
     * mistake) have opposite correct answers. Refusing asks, which is cheap; guessing
     * produces a chapter with a page missing and no way to tell.
     */
    if (seen.has(line)) throw new GalleryError('bad_url', `line ${i + 1} repeats an earlier URL`)
    seen.add(line)
    images.push({ id: String(i + 1), link: line, position: i + 1 })
  }
  return { provider: 'direct', id: '', title: null, nsfw: false, images }
}
