import { MAX_ORIGINAL_BYTES, type Storage } from '@palscans/core/storage'
import {
  type ChapterProcessing,
  chapterPages,
  chapters,
  type Db,
  type PageVariant,
} from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import { processImage } from '../lib/image.js'
import { log } from '../lib/log.js'
import { revalidateWeb } from '../lib/revalidate.js'
import { watermarkFor } from './chapter-process.js'

/**
 * Replace exactly one page of a chapter with an uploaded image.
 *
 * ## Why this is not `chapter.process`
 *
 * `chapter.process` rebuilds a chapter from its `sources`: it is the right tool when the
 * chapter *has* sources, and the page editor's own replace goes through it. A chapter
 * imported in remote mode has none. Its pages live on the host it came from, the processing
 * document records `results: {}`, and there is nothing to edit or re-run — so the one fix an
 * operator actually needs, "this page is bad, here is a better one", had no path at all
 * short of re-downloading the entire chapter into our storage first.
 *
 * This job is that path. It encodes one upload, writes the variants to our bucket, and
 * points one `chapter_pages` row at them. Every other page of the chapter is untouched and
 * stays remote, which is the whole point: the operator pays for one page of storage, not a
 * hundred, and the rest of the chapter keeps costing nothing.
 *
 * ## A chapter may be half ours
 *
 * Nothing downstream has to learn about that, because nothing downstream ever asked about
 * the chapter — `toReaderPages` already branches per page on `remoteUrl`, so a row that
 * stops being remote simply starts being served from the CDN like any other stored page.
 * The mixed state is not a new concept, it is the absence of one.
 *
 * ## What this job deliberately does not do
 *
 * It does not touch `processing`. For a remote chapter the document describes the import,
 * not the pages, and rewriting it to pretend the chapter has a source would make the next
 * `chapter.fetch` or watermark re-apply operate on a lie. The replacement is recorded in
 * `replacedPages` purely so the panel can show it and an operator can see what was changed
 * by hand — nothing reads it to rebuild anything.
 *
 * The one thing that *will* discard this work is an explicit re-import of the chapter from
 * a gallery link, which replaces every page by design and says so before it runs.
 */

export interface ReplacePageDeps {
  db: Db
  storage: Storage
  now?: () => Date
}

export class ReplacePageError extends Error {
  constructor(
    readonly code: 'not_found' | 'too_large' | 'missing_object' | 'splits',
    message: string,
  ) {
    super(message)
    this.name = 'ReplacePageError'
  }
}

export const replaceChapterPage = async (
  chapterId: number,
  idx: number,
  key: string,
  deps: ReplacePageDeps,
): Promise<{ key: string; width: number; height: number }> => {
  const { db, storage } = deps
  const at = (deps.now ?? (() => new Date()))()

  const [chapter] = await db
    .select({ seriesId: chapters.seriesId, processing: chapters.processing })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)
  if (!chapter) throw new ReplacePageError('not_found', `no chapter ${chapterId}`)

  const [existing] = await db
    .select({ idx: chapterPages.idx })
    .from(chapterPages)
    .where(and(eq(chapterPages.chapterId, chapterId), eq(chapterPages.idx, idx)))
    .limit(1)
  if (!existing) throw new ReplacePageError('not_found', `chapter ${chapterId} has no page ${idx}`)

  // HEAD before GET, as the encode does: an oversized object the browser PUT straight to
  // the store is refused rather than pulled into memory for sharp.
  const info = await storage.head(key)
  if (!info) throw new ReplacePageError('missing_object', `missing object ${key}`)
  if (info.size > MAX_ORIGINAL_BYTES)
    throw new ReplacePageError('too_large', `source too large: ${info.size} bytes`)
  const original = await storage.get(key)
  if (!original) throw new ReplacePageError('missing_object', `missing object ${key}`)

  const encoded = await processImage(original, {
    prefix: `pages/${chapter.seriesId}/${chapterId}`,
    /*
     * The same `idx * 10` spacing the encode uses, so a page replaced here and one produced
     * by a full run are named by the same rule. Collisions are not a concern either way:
     * the variant key carries the content hash, so two different images can never land on
     * one object, and the same image twice is the same object by design.
     */
    startIdx: idx * 10,
    watermark: await watermarkFor(db),
  })

  /*
   * A tall upload is cut into several pages by the encode, which is right for an import and
   * wrong here: this operation replaces one page with one page, and quietly turning page 7
   * into three pages would renumber everything after it. Refused with a code the panel can
   * explain, rather than silently doing something else.
   */
  if (encoded.length !== 1)
    throw new ReplacePageError(
      'splits',
      `image splits into ${encoded.length} pages; a single-page replace needs one`,
    )
  const page = encoded[0]
  if (!page) throw new ReplacePageError('splits', 'no page produced')

  for (const v of page.variants) {
    await storage.put(v.key, v.data, {
      contentType: v.fmt === 'avif' ? 'image/avif' : 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    })
  }
  const largestWebp = [...page.variants]
    .filter((v) => v.fmt === 'webp')
    .sort((a, b) => b.w - a.w)[0]
  if (!largestWebp) throw new ReplacePageError('splits', 'no variants produced')
  const variants: PageVariant[] = page.variants.map((v) => ({
    w: v.w,
    fmt: v.fmt,
    bytes: v.bytes,
    key: v.key,
  }))

  const doc: ChapterProcessing | null = chapter.processing
    ? {
        ...chapter.processing,
        replacedPages: {
          ...(chapter.processing.replacedPages ?? {}),
          [String(idx)]: { key: largestWebp.key, at: at.toISOString() },
        },
      }
    : null

  await db.transaction(async (tx) => {
    await tx
      .update(chapterPages)
      .set({
        key: largestWebp.key,
        /*
         * The row stops being remote. This single column is what moves the page from the
         * other host onto our CDN, because `toReaderPages` reads it per page and nothing
         * else in the reader knows or cares how the chapter was imported.
         */
        remoteUrl: null,
        width: page.width,
        height: page.height,
        bytes: largestWebp.bytes,
        blurHash: page.blurHash,
        variants,
      })
      .where(and(eq(chapterPages.chapterId, chapterId), eq(chapterPages.idx, idx)))
    if (doc)
      await tx
        .update(chapters)
        .set({ processing: doc, updatedAt: at })
        .where(eq(chapters.id, chapterId))
  })

  await revalidateWeb(['catalog'])
  log.info('chapter.page.replace: page replaced', {
    chapterId,
    idx,
    key: largestWebp.key,
  })
  return { key: largestWebp.key, width: page.width, height: page.height }
}
