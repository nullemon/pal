import { createHash } from 'node:crypto'
import {
  directUrlProblem,
  downloadGalleryImage,
  GalleryError,
  type GalleryPost,
  resolveGallery,
} from '@palscans/core/gallery'
import { IMAGE_EXTENSIONS } from '@palscans/core/images'
import type { Queue } from '@palscans/core/queue'
import { MAX_ORIGINAL_BYTES, type Storage } from '@palscans/core/storage'
import {
  type ChapterProcessing,
  type ChapterSource,
  type chapterPages,
  chapters,
  type Db,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { blurHashFor } from '../lib/image.js'
import { log } from '../lib/log.js'
import { pool } from '../lib/pool.js'
import { commitChapterPages } from './chapter-process.js'

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

/**
 * A chapter whose page URLs were given outright, with no gallery to resolve.
 *
 * Re-validated here even though the parser already checked them: these have been sitting in
 * a database row since the import was queued, and the worker is what actually makes the
 * request. A guard that only runs at the edge is a guard that stops applying the moment
 * anything else learns to write that row.
 */
const directPost = (links: string[], title: string | null): GalleryPost => {
  if (links.length === 0) throw new GalleryError('empty')
  for (const [i, link] of links.entries()) {
    const problem = directUrlProblem(link)
    if (problem)
      throw new GalleryError(problem === 'host' ? 'bad_image_host' : 'bad_url', `page ${i + 1}`)
  }
  return {
    provider: 'direct',
    id: '',
    title,
    nsfw: false,
    images: links.map((link, i) => ({ id: String(i + 1), link, position: i + 1 })),
  }
}

export const fetchChapterGallery = async (
  chapterId: number,
  deps: ChapterFetchDeps,
): Promise<void> => {
  const { db, storage, queue } = deps
  const [row] = await db
    .select({
      id: chapters.id,
      seriesId: chapters.seriesId,
      number: chapters.number,
      state: chapters.state,
      processing: chapters.processing,
      publishedAt: chapters.publishedAt,
      isPremium: chapters.isPremium,
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
    post = pending.links?.length
      ? directPost(pending.links, pending.title ?? null)
      : await resolveGallery(pending.url, { token: deps.token, fetchImpl: deps.fetchImpl })
  } catch (error) {
    await fail(error)
    return
  }

  log.info('chapter.fetch start', { chapterId, images: post.images.length, id: post.id })

  /**
   * Remote or stored?
   *
   * Remote is the default for a link import: the pages stay on the host and are served
   * through our proxy, so the bucket stays empty. It only works while that host will answer
   * our server repeatedly, because the proxy fetches on every cache miss — which is exactly
   * what the probe below tests, and the only honest way to decide. A host that serves the
   * first request and refuses the second would give a chapter that imports cleanly and then
   * fails for readers a day later, which is the worst possible failure for this feature.
   */
  let mode: 'remote' | 'storage' = pending.mode ?? 'remote'
  const first = post.images[0]
  /**
   * The probe's own copy of page one, kept rather than discarded.
   *
   * Whichever mode wins needs those bytes anyway, and a host that is rationing us is exactly
   * the host where a third request for the same image fails. Throwing them away and
   * re-fetching is how the fallback breaks on the only kind of host it exists for.
   */
  let probed: Awaited<ReturnType<typeof downloadGalleryImage>> | undefined
  if (mode === 'remote' && first) {
    const fetchFirst = () =>
      downloadGalleryImage(first.link, {
        token: deps.token,
        fetchImpl: deps.fetchImpl,
        maxBytes: MAX_ORIGINAL_BYTES,
      })
    try {
      probed = await fetchFirst()
      // Twice, deliberately. One success proves nothing about a host that rate-limits, or
      // that tolerates a browser's first hit and nothing after it.
      await fetchFirst()
    } catch (error) {
      if (!probed) {
        // The first request failed, so neither mode can work. Report the real reason. No
        // interval to clear: the progress flush below has not started yet.
        await fail(error)
        return
      }
      log.info('chapter.fetch: host will not serve us repeatedly, storing instead', {
        chapterId,
        error: errorMessage(error),
      })
      mode = 'storage'
    }
  }

  /** Page one comes from the probe when it has it; everything else is fetched here. */
  const imageAt = async (link: string, idx: number) =>
    idx === 0 && probed
      ? probed
      : await downloadGalleryImage(link, {
          token: deps.token,
          fetchImpl: deps.fetchImpl,
          maxBytes: MAX_ORIGINAL_BYTES,
        })

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

  if (mode === 'remote') {
    const rows = new Array<typeof chapterPages.$inferInsert | undefined>(post.images.length)
    try {
      await pool(post.images, DOWNLOAD_CONCURRENCY, async (image, idx) => {
        /**
         * Fetched and thrown away.
         *
         * The bytes are needed once — to prove the URL is an image rather than a login page,
         * and to read the dimensions the reader lays out with — and then deliberately not
         * stored. Skipping this and trusting the host would mean a chapter whose pages are
         * the wrong size or not images at all, discovered by a reader.
         */
        const { bytes, type } = await imageAt(image.link, idx)
        const meta = await sharp(bytes).metadata()
        if (!meta.width || !meta.height)
          throw new GalleryError('not_an_image', `page ${idx + 1} has no dimensions`)
        rows[idx] = {
          chapterId,
          idx,
          /**
           * Not a bucket path, and obviously so.
           *
           * `key` is NOT NULL and every consumer reads it, so it keeps a value — but one
           * that cannot be mistaken for an object. Anything that reaches the store with it
           * fails loudly instead of quietly looking for `remote:abc` and reporting a missing
           * object, which is the confusing version of the same bug.
           */
          key: `remote:${createHash('sha256').update(image.link).digest('hex').slice(0, 12)}.${IMAGE_EXTENSIONS[type]}`,
          remoteUrl: image.link,
          width: meta.width,
          height: meta.height,
          bytes: bytes.byteLength,
          blurHash: await blurHashFor(sharp(bytes)),
          variants: [],
        }
        working.progress.done += 1
        dirty = true
      })
    } catch (error) {
      clearInterval(flush)
      await fail(error)
      return
    }
    clearInterval(flush)
    const complete = rows.filter((r): r is typeof chapterPages.$inferInsert => r !== undefined)
    if (complete.length !== post.images.length) {
      await fail(new GalleryError('unavailable', 'some pages could not be read'))
      return
    }
    const finished: ChapterProcessing = {
      ...working,
      sources: [],
      results: {},
      errors: {},
      progress: { done: complete.length, total: complete.length },
      pageSource: 'remote',
      finishedAt: new Date().toISOString(),
    }
    // Kept, unlike the storage path: it is the only record of where these pages come from,
    // and the panel needs it to say what this chapter actually is.
    finished.fetch = { ...pending, mode: 'remote' }
    const state = await commitChapterPages({
      chapterId,
      rows: complete,
      processing: finished,
      chapter: {
        seriesId: row.seriesId,
        number: Number(row.number),
        publishedAt: row.publishedAt,
        isPremium: row.isPremium,
      },
      db,
    })
    log.info('chapter.fetch done (remote)', { chapterId, pages: complete.length, state })
    return
  }

  try {
    await pool(post.images, DOWNLOAD_CONCURRENCY, async (image, idx) => {
      const { bytes, type } = await imageAt(image.link, idx)
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
