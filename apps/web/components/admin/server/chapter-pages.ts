import 'server-only'
import {
  deletePages,
  flattenPages,
  insertSourceAt,
  markForReprocess,
  type PagePlan,
  pageRefKey,
  reorderSources,
  replaceSourceAt,
} from '@palscans/core/chapters'
import {
  type ChapterProcessing,
  type ChapterSource,
  chapterPages,
  chapters,
  type Db,
  getDb,
  type ProcessedPage,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import { enqueueProcess } from '@/components/admin/server/chapters'
import { signedStorageUrl } from '@/lib/storage/upload'

/**
 * Editing the pages of a chapter that already exists (Admin -> Chapters -> Pages).
 *
 * Every edit goes through `@palscans/core/chapters`, which rewrites the processing document,
 * and `chapter_pages` is then rebuilt from that document by the same flatten the worker uses.
 * The alternative — editing the rows directly — looks identical until the next
 * `watermark.reapply` or retry rebuilds them from the untouched originals and silently
 * restores what was deleted. See the note at the top of that module.
 */

/** A page as the editor grid sees it. `id` is stable across reorders; positions are not. */
export interface EditorPage {
  /** `sourceIdx:segment` — survives every edit, which array positions do not. */
  id: string
  idx: number
  width: number
  height: number
  blurHash: string | null
  url: string
  /** True when this page is one of several cut from a single upload (a long strip). */
  split: boolean
}

type Plan = PagePlan<ChapterSource, ProcessedPage>

const planOf = (doc: ChapterProcessing): Plan => ({
  sources: doc.sources,
  results: doc.results,
  errors: doc.errors,
  dropped: doc.dropped,
})

/**
 * Signed rather than public URLs, always.
 *
 * The reader signs only locked chapters, because a public chapter's pages are public anyway.
 * The editor cannot make that distinction usefully: the chapters most likely to need fixing
 * are the unpublished and premium ones, and a grid that silently showed broken images for
 * exactly those would be worse than useless. Signing everything costs one presign per
 * thumbnail and removes the case analysis.
 */
const thumbnailUrl = async (page: ProcessedPage): Promise<string> => {
  // The narrowest variant that exists — a grid of 200px thumbnails has no use for the 1080.
  const smallest = [...page.variants]
    .filter((v) => typeof v.w === 'number' && v.w > 0)
    .sort((a, b) => a.w - b.w)[0]
  return signedStorageUrl(smallest?.key ?? page.key)
}

export const editorPages = async (doc: ChapterProcessing): Promise<EditorPage[]> => {
  const flat = flattenPages(planOf(doc))
  const segments = new Map<number, number>()
  for (const f of flat) segments.set(f.source.idx, (segments.get(f.source.idx) ?? 0) + 1)
  return Promise.all(
    flat.map(async (f) => ({
      id: pageRefKey(f.source.idx, f.segment),
      idx: f.idx,
      width: f.page.width,
      height: f.page.height,
      blurHash: f.page.blurHash,
      url: await thumbnailUrl(f.page),
      split: (segments.get(f.source.idx) ?? 1) > 1,
    })),
  )
}

export interface PageEdits {
  /** Page ids in the order the operator arranged them. Omitted means "leave the order". */
  order?: string[]
  /** Page ids to remove. */
  deleted?: string[]
}

/**
 * Apply an edit to the processing document.
 *
 * The caller may send an order that still names pages it is also deleting; it does not have
 * to reconcile its own pending changes before sending them.
 *
 * The order is page-level because the grid is, but reordering is source-level: a source's
 * segments are regenerated together from one original and cannot be separated durably. The
 * source order is therefore taken from where each source *first* appears in the requested
 * page order, and the caller is handed back the arrangement that actually resulted rather
 * than being left to assume it got what it asked for.
 */
export const applyPageEdits = (doc: ChapterProcessing, edits: PageEdits): ChapterProcessing => {
  let plan = planOf(doc)

  // Order first, then deletions — not the other way round.
  //
  // Every edit renumbers sources, and the ids the caller sent describe the document *it* was
  // looking at. Deleting first therefore renumbers the survivors out from under the order: a
  // grid that deleted page 1 and dragged the last page to the front would find its drag
  // applied to whichever upload inherited the vacated index. Reordering first leaves the
  // caller's ids valid while they are being read, and the deletions are then translated
  // through the permutation it produced.
  let moved = new Map(plan.sources.map((s) => [s.idx, s.idx]))

  if (edits.order?.length) {
    const flat = flattenPages(plan)
    const byId = new Map(flat.map((f) => [pageRefKey(f.source.idx, f.segment), f.source.idx]))
    const seen: number[] = []
    for (const id of edits.order) {
      const sourceIdx = byId.get(id)
      if (sourceIdx === undefined || seen.includes(sourceIdx)) continue
      seen.push(sourceIdx)
    }
    // Anything the caller did not mention keeps its place at the end, so a partial order is a
    // partial order rather than a silent deletion of everything it left out.
    for (const s of [...plan.sources].sort((a, b) => a.idx - b.idx))
      if (!seen.includes(s.idx)) seen.push(s.idx)
    plan = reorderSources(plan, seen)
    // `reorderSources` sets each source's new index to its position in `seen`.
    moved = new Map(seen.map((original, next) => [original, next]))
  }

  if (edits.deleted?.length) {
    const flat = flattenPages(plan)
    const positions = edits.deleted
      .map((id) => {
        const [rawSource, rawSegment] = id.split(':')
        const original = Number(rawSource)
        const segment = Number(rawSegment)
        if (!Number.isInteger(original) || !Number.isInteger(segment)) return -1
        const current = moved.get(original)
        if (current === undefined) return -1
        return flat.findIndex((f) => f.source.idx === current && f.segment === segment)
      })
      .filter((p) => p >= 0)
    if (positions.length) plan = deletePages(plan, positions)
  }

  return {
    ...doc,
    sources: plan.sources,
    results: plan.results,
    errors: plan.errors ?? {},
    dropped: plan.dropped,
  }
}

/**
 * Persist an edit: the document and the rows it implies, in one transaction.
 *
 * `chapter_pages` has `(chapter_id, idx)` as its primary key, so an edit cannot be expressed
 * as a series of UPDATEs — swapping two rows collides on the key partway through. The rows
 * for the chapter are deleted and reinserted instead, which is also the only version that
 * cannot leave a half-applied order behind if it fails.
 */
export const savePageEdits = async (
  chapterId: number,
  edits: PageEdits,
  db?: Db,
): Promise<{ doc: ChapterProcessing; count: number } | null> => {
  const database = db ?? (await getDb())
  const [row] = await database
    .select({ processing: chapters.processing })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)
  if (!row?.processing) return null

  const doc = applyPageEdits(row.processing, edits)
  const rows = flattenPages(planOf(doc)).map(({ page, idx }) => ({
    chapterId,
    idx,
    key: page.key,
    width: page.width,
    height: page.height,
    bytes: page.bytes,
    blurHash: page.blurHash,
    variants: page.variants,
  }))

  await database.transaction(async (tx) => {
    await tx
      .update(chapters)
      .set({ processing: doc, updatedAt: new Date() })
      .where(eq(chapters.id, chapterId))
    await tx.delete(chapterPages).where(eq(chapterPages.chapterId, chapterId))
    if (rows.length) await tx.insert(chapterPages).values(rows)
  })

  return { doc, count: rows.length }
}

/**
 * Put a newly uploaded file in place of a page, or between two of them, and queue the one
 * source that needs encoding.
 *
 * Unlike a reorder or a delete this is not instant: the new image has to be re-encoded into
 * its variants and watermarked before it can be served, so the chapter goes to `processing`
 * and the caller is told to expect that.
 */
export const addPageSource = async (
  chapterId: number,
  input: { op: 'replace' | 'insert'; position: number; key: string; bytes: number },
  db?: Db,
): Promise<{ doc: ChapterProcessing; sourceIdx: number } | null> => {
  const database = db ?? (await getDb())
  const [row] = await database
    .select({ processing: chapters.processing })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)
  if (!row?.processing) return null

  const source = {
    key: input.key,
    bytes: input.bytes,
    // The key is content-addressed, so the digest is recoverable from it and does not need
    // to be trusted from the client a second time.
    sha256: input.key.split('-').pop()?.split('.')[0] ?? '',
  }
  const edit =
    input.op === 'replace'
      ? replaceSourceAt(planOf(row.processing), input.position, source)
      : insertSourceAt(planOf(row.processing), input.position, source)

  // An insert has no stale results to clear, but still has to be named in `errors`, or the
  // run falls through to re-encoding the whole chapter. See markForReprocess.
  const plan = markForReprocess(edit.plan, [edit.sourceIdx], input.op)
  const doc: ChapterProcessing = {
    ...row.processing,
    sources: plan.sources,
    results: plan.results,
    errors: plan.errors ?? {},
    dropped: plan.dropped,
    mode: 'failed',
    attempt: (row.processing.attempt ?? 0) + 1,
    progress: { done: 0, total: plan.sources.length },
    finishedAt: null,
  }

  await database
    .update(chapters)
    .set({ processing: doc, state: 'processing', updatedAt: new Date() })
    .where(eq(chapters.id, chapterId))
  await enqueueProcess(chapterId, doc.attempt)
  return { doc, sourceIdx: edit.sourceIdx }
}
