import { createHash } from 'node:crypto'
import {
  downloadGalleryImage,
  GalleryError,
  type GalleryPost,
  resolveGallery,
} from '@palscans/core/gallery'
import { IMAGE_EXTENSIONS } from '@palscans/core/images'
import type { Queue } from '@palscans/core/queue'
import { MAX_ORIGINAL_BYTES, type Storage } from '@palscans/core/storage'
import { type ChapterProcessing, type ChapterSource, chapters, type Db } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { log } from '../lib/log.js'
import { pool } from '../lib/pool.js'

/**
 * `chapter.fetch` — turn a pasted gallery link into the chapter's uploaded originals.
 *
 * This job exists so that the import reuses the pipeline instead of becoming a second one.
 * Its entire output is the `sources` array that the browser-upload path writes at commit
 * time: the same key shape under `uploads/`, the same ordering contract, the same processing
 * document. Once it has written that and enqueued `chapter.process`, nothing downstream —
 * watermarking, variants, blurhash, `chapter_pages`, publishing, notifications — can tell an
 * imported chapter from an uploaded one, which is the only way this feature stays correct as
 * the pipeline changes around it.
 *
 * It runs in the worker rather than in the web request because the download is the expensive
 * part: forty pages is eighty megabytes through a single request handler on a 2 GB box, with
 * a proxy timeout waiting at the end of it. Here it gets retries, progress, and a shutdown
 * that does not abandon a half-written chapter.
 */

/** Downloads in flight. Three overlaps the latency without three full images in memory. */
const DOWNLOAD_CONCURRENCY = 3

/** Written to `processing.errors` under this key, so the panel has somewhere to show it. */
const FETCH_ERROR_KEY = 'fetch'

export interface ChapterFetchDeps {
  db: Db
  storage: Storage
  queue: Queue
  /** Optional ImgChest token. The default path needs none; this is the API escape hatch. */
  token?: string | null
  /** Injected in tests. */
  fetchImpl?: typeof globalThis.fetch
}

const errorMessage = (error: unknown): string => {
  if (error instanceof GalleryError) return `${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

/**
 * Human-readable reason for a failure, keyed off the code rather than the message.
 *
 * The operator sees this in the chapter list, so it has to say what to do next. "unavailable"
 * on its own sends them to the logs for something that is usually a retry.
 */
const REASONS: Record<string, string> = {
  bad_url: 'That is not a gallery link we can read.',
  not_found: 'The gallery does not exist, or is private.',
  empty: 'The gallery has no images in it.',
  rate_limited: 'The image host is rate-limiting us. Try again in a few minutes.',
  unavailable: 'Could not reach the image host. Try again.',
  unparseable: 'The host answered with something we could not read — this needs a code fix.',
  bad_image_host: 'The gallery points at an address we refuse to fetch from.',
  too_many: 'The gallery has more images than a chapter can hold.',
  too_large: 'One of the images is larger than the pipeline accepts.',
  not_an_image: 'One of the files in the gallery is not an image.',
}

const reasonFor = (error: unknown): string =>
  (error instanceof GalleryError ? REASONS[error.code] : undefined) ?? errorMessage(error)

/**
 * `uploads/<series>/<chapter>/<idx>-<sha12>.<ext>` — byte-identical in shape to the key the
 * upload intent signs, because `/api/upload/commit` and the repair editor both assume that
 * prefix, and an import that invented its own layout would be invisible to both.
 */
const keyFor = (seriesId: number, chapterId: number, idx: number, sha: string, ext: string) =>
  `uploads/${seriesId}/${chapterId}/${String(idx).padStart(4, '0')}-${sha.slice(0, 12)}.${ext}`

export const fetchChapterGallery = async (
  chapterId: number,
  deps: ChapterFetchDeps,
): Promise<void> => {
  const { db, storage, queue } = deps
  const [row] = await db
    .select({
      id: chapters.id,
      seriesId: chapters.seriesId,
      state: chapters.state,
      processing: chapters.processing,
    })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)
  if (!row) {
    log.warn('chapter.fetch: no such chapter', { chapterId })
    return
  }
  const doc: ChapterProcessing | null = row.processing
  const pending = doc?.fetch
  if (!doc || !pending) {
    // A redelivered job after the download already finished. The marker is cleared on
    // success precisely so this is a no-op rather than a second download.
    log.info('chapter.fetch: nothing pending', { chapterId })
    return
  }

  const fail = async (error: unknown) => {
    log.warn('chapter.fetch failed', { chapterId, error: errorMessage(error) })
    await db
      .update(chapters)
      .set({
        state: 'failed',
        processing: {
          ...doc,
          errors: { ...doc.errors, [FETCH_ERROR_KEY]: reasonFor(error) },
          finishedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(chapters.id, chapterId))
  }

  let post: GalleryPost
  try {
    post = await resolveGallery(pending.url, { token: deps.token, fetchImpl: deps.fetchImpl })
  } catch (error) {
    await fail(error)
    return
  }

  log.info('chapter.fetch start', { chapterId, images: post.images.length, id: post.id })
  const working: ChapterProcessing = {
    ...doc,
    errors: {},
    progress: { done: 0, total: post.images.length },
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
  const persist = async () => {
    await db
      .update(chapters)
      .set({ processing: working, updatedAt: new Date() })
      .where(eq(chapters.id, chapterId))
  }
  await persist()

  const sources = new Array<ChapterSource | undefined>(post.images.length)
  let dirty = false
  // Same reasoning as `chapter.process`: a progress write is cosmetic and runs often, so a
  // transient database error here must not take the process down mid-download.
  const flush = setInterval(() => {
    if (!dirty) return
    dirty = false
    persist().catch((error) => {
      log.warn('chapter.fetch progress write failed', { chapterId, error: errorMessage(error) })
    })
  }, 750)
  flush.unref()

  try {
    await pool(post.images, DOWNLOAD_CONCURRENCY, async (image, idx) => {
      const { bytes, type } = await downloadGalleryImage(image.link, {
        token: deps.token,
        fetchImpl: deps.fetchImpl,
        maxBytes: MAX_ORIGINAL_BYTES,
      })
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const key = keyFor(row.seriesId, chapterId, idx, sha256, IMAGE_EXTENSIONS[type])
      await storage.put(key, bytes, { contentType: type })
      // Indexed, not pushed: `pool` finishes out of order and the page order is the gallery's.
      sources[idx] = { idx, key, bytes: bytes.byteLength, sha256 }
      working.progress.done += 1
      dirty = true
    })
  } catch (error) {
    clearInterval(flush)
    await fail(error)
    return
  }
  clearInterval(flush)

  const complete = sources.filter((s): s is ChapterSource => s !== undefined)
  if (complete.length !== post.images.length) {
    // Belt and braces: `pool` rethrows, so this is unreachable unless it changes under us.
    await fail(new GalleryError('unavailable', 'some images did not download'))
    return
  }

  const attempt = doc.attempt + 1
  const next: ChapterProcessing = {
    ...working,
    sources: complete,
    results: {},
    errors: {},
    progress: { done: 0, total: complete.length },
    attempt,
    mode: 'all',
    startedAt: null,
    finishedAt: null,
  }
  // Clearing the marker is what makes a redelivery of this job a no-op, and what tells
  // Retry to resume an encode rather than a download.
  delete next.fetch
  await db
    .update(chapters)
    .set({ state: 'processing', processing: next, updatedAt: new Date() })
    .where(eq(chapters.id, chapterId))

  try {
    await queue.add(
      'chapter.process',
      { chapterId },
      { jobId: `chapter.process:${chapterId}:${attempt}`, attempts: 3 },
    )
  } catch (error) {
    // The sources are committed, so this is recoverable: the stale-processing sweep in the
    // worker's tick picks the chapter up. Saying so beats a silent stall.
    log.warn('chapter.fetch: could not enqueue the encode', {
      chapterId,
      error: errorMessage(error),
    })
  }
  log.info('chapter.fetch done', { chapterId, pages: complete.length, attempt })
}
