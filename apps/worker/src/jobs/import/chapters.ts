import { createHash } from 'node:crypto'
import type { LegacySource, MappedChapter } from '@palscans/core/import'
import type { Queue } from '@palscans/core/queue'
import { MAX_ORIGINAL_BYTES, type Storage } from '@palscans/core/storage'
import { type ChapterProcessing, type ChapterSource, chapters, type Db } from '@palscans/db'
import { and, eq } from 'drizzle-orm'

/**
 * The chapter half of the importer. Legacy page images are *not* re-encoded here: they are
 * uploaded as originals under the same `uploads/<series>/<chapter>/` prefix the admin upload
 * flow uses, and then handed to the existing `chapter.process` job (docs/03). The importer
 * therefore inherits variant generation, blurhashes, long-strip splitting and per-page error
 * reporting for free, and one pipeline stays responsible for what a page looks like.
 */

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

/** JPEG · PNG · GIF · WebP · AVIF, by magic bytes — the stored extension is not trusted. */
const sniff = (bytes: Uint8Array): string | null => {
  if (bytes.length < 12) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  const tag = String.fromCharCode(...bytes.subarray(8, 12))
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && tag === 'WEBP') return 'webp'
  if (String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp' && tag.startsWith('avi'))
    return 'avif'
  return null
}

export interface ChapterWriteResult {
  chapterId: number
  /** Pages uploaded as originals; zero when the run is catalogue-only. */
  pages: number
  /** Set when `chapter.process` was enqueued for this chapter. */
  queued: boolean
  errors: string[]
}

export interface ChapterWriteDeps {
  storage: Storage
  queue: Queue
  source: LegacySource
  skipImages: boolean
  now: Date
}

/**
 * Upsert one chapter and stage its pages. Returns the local id plus what actually happened,
 * so the runner can count pages and surface per-chapter failures without throwing away the
 * whole batch for one unreadable image.
 */
export const writeChapter = async (
  tx: Db,
  m: MappedChapter,
  seriesId: number,
  existingId: number | null,
  deps: ChapterWriteDeps,
): Promise<ChapterWriteResult> => {
  if (m.number === null) throw new Error(`chapter name "${m.rawName}" has no parsable number`)
  const number = Number(m.number)
  const publishedAt = m.createdAt ? new Date(m.createdAt) : deps.now
  const errors: string[] = []

  // Catalogue-only runs leave the chapter unpublished on purpose: a published chapter with no
  // pages is a broken reader page, and a later image pass promotes it.
  const base = {
    title: m.title,
    volume: m.volume,
    publishedAt: Number.isNaN(publishedAt.getTime()) ? deps.now : publishedAt,
  }

  let chapterId = existingId
  if (chapterId === null) {
    const [existing] = await tx
      .select({ id: chapters.id })
      .from(chapters)
      .where(and(eq(chapters.seriesId, seriesId), eq(chapters.number, number)))
      .limit(1)
    if (existing) chapterId = existing.id
  }

  if (chapterId === null) {
    const [row] = await tx
      .insert(chapters)
      .values({ seriesId, number, state: 'draft', ...base })
      .onConflictDoUpdate({
        target: [chapters.seriesId, chapters.number],
        set: base,
      })
      .returning({ id: chapters.id })
    if (!row) throw new Error(`could not insert chapter ${m.rawName}`)
    chapterId = row.id
  } else {
    await tx.update(chapters).set(base).where(eq(chapters.id, chapterId))
  }

  if (deps.skipImages || m.pages.length === 0) return { chapterId, pages: 0, queued: false, errors }

  const sources: ChapterSource[] = []
  for (const page of m.pages) {
    try {
      const image = await deps.source.readPage({ idx: page.idx, path: page.path })
      if (image.bytes.byteLength === 0) throw new Error('empty file')
      if (image.bytes.byteLength > MAX_ORIGINAL_BYTES)
        throw new Error(`${image.bytes.byteLength} bytes exceeds the original limit`)
      const ext = sniff(image.bytes) ?? EXT_BY_TYPE[image.contentType ?? ''] ?? null
      if (!ext) throw new Error('not a supported image')
      const sha256 = createHash('sha256').update(image.bytes).digest('hex')
      const key = `uploads/${seriesId}/${chapterId}/${String(page.idx).padStart(4, '0')}-${sha256.slice(0, 12)}.${ext}`
      await deps.storage.put(key, image.bytes, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      })
      sources.push({ idx: sources.length, key, bytes: image.bytes.byteLength, sha256 })
    } catch (err) {
      errors.push(
        `page ${page.idx + 1} (${page.path}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  if (sources.length === 0) return { chapterId, pages: 0, queued: false, errors }

  const processing: ChapterProcessing = {
    sources,
    progress: { done: 0, total: sources.length },
    errors: {},
    attempt: 1,
    mode: 'all',
    after: { isPremium: false, publishedAt: base.publishedAt.toISOString() },
    startedAt: null,
    finishedAt: null,
  }
  await tx
    .update(chapters)
    .set({ state: 'processing', processing, updatedAt: deps.now })
    .where(eq(chapters.id, chapterId))

  let queued = false
  try {
    await deps.queue.add(
      'chapter.process',
      { chapterId },
      { jobId: `chapter.process:${chapterId}:import`, attempts: 3 },
    )
    queued = true
  } catch (err) {
    // The worker's scheduler picks up `processing` rows nothing ever claimed, so a queue
    // hiccup delays the chapter rather than losing it. Still worth reporting.
    errors.push(`queue: ${err instanceof Error ? err.message : String(err)}`)
  }

  return { chapterId, pages: sources.length, queued, errors }
}
