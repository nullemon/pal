/**
 * Editing the pages of a chapter that already exists: reorder, delete, and the flattening
 * both the worker and the panel have to agree on.
 *
 * ## Why this is not simply "rewrite chapter_pages"
 *
 * `chapter_pages` is *derived*, not authored. `chapter-process` builds it by walking the
 * processing document's sources in index order and appending each source's results:
 *
 * ```
 * for (const source of sources.sort(byIdx))
 *   for (const page of results[source.idx])
 *     rows.push({ idx: rows.length, ... })
 * ```
 *
 * So the rows are a pure function of (source order, results). An editor that rewrote the
 * rows alone would look correct and *stay* correct — right up until the next run that
 * rebuilds them. `watermark.reapply` re-derives every page from the uploaded originals, and
 * a retry re-runs processing; either one recomputes that flatten from the untouched sources
 * and silently restores the deleted page and the old order. Nobody would connect the
 * regression to an edit made weeks earlier.
 *
 * The fix is that this module owns the flatten, both callers use it, and every edit is
 * expressed against the document the flatten reads. Then there is no second representation
 * to drift.
 *
 * ## `dropped`, and why deletion needs it
 *
 * Removing a whole source is enough to delete its pages: it stops being processed at all.
 * But one source can emit several pages — a long strip is split into segments — and
 * deleting *one segment* cannot be expressed by removing the source, because the other
 * segments must survive. Removing the entry from `results` alone does not survive either:
 * the next run regenerates every segment of that source from the original.
 *
 * `dropped` records those deletions as `sourceIdx:segment` and the flatten always applies
 * it, so a deleted segment stays deleted through any number of reprocessing runs. It is the
 * only part of the document that describes an operator's intent rather than a machine's
 * output, which is exactly why it cannot be rebuilt from the originals.
 */

/** The shape this module needs from a source row; the real type lives in @palscans/db. */
export interface SourceLike {
  idx: number
}

/**
 * The editable half of `ChapterProcessing`. Generic over the source and page types so core
 * stays free of a dependency on the database package, which depends on core.
 */
export interface PagePlan<S extends SourceLike, P> {
  sources: S[]
  results?: Record<string, P[]>
  errors?: Record<string, string>
  /** `sourceIdx:segment` entries the flatten skips. See the note above. */
  dropped?: string[]
}

/** One page in display order, with the source and segment it came from. */
export interface FlatPage<S, P> {
  page: P
  source: S
  /** Position within that source's results — 0 unless the source was split. */
  segment: number
  /** Display order, which is what `chapter_pages.idx` is set to. */
  idx: number
}

export const pageRefKey = (sourceIdx: number, segment: number): string => `${sourceIdx}:${segment}`

/**
 * The pages a processing document implies, in display order.
 *
 * This is the single definition of that mapping. `chapter-process` numbers `chapter_pages`
 * from it and the editor reads it, so the rows in the database and the grid in the panel
 * cannot disagree about what page 7 is.
 */
export const flattenPages = <S extends SourceLike, P>(
  plan: PagePlan<S, P>,
): Array<FlatPage<S, P>> => {
  const dropped = new Set(plan.dropped ?? [])
  const out: Array<FlatPage<S, P>> = []
  for (const source of [...plan.sources].sort((a, b) => a.idx - b.idx)) {
    const pages = plan.results?.[String(source.idx)] ?? []
    for (const [segment, page] of pages.entries()) {
      if (dropped.has(pageRefKey(source.idx, segment))) continue
      out.push({ page, source, segment, idx: out.length })
    }
  }
  return out
}

/**
 * Renumber sources to `0..n-1` in the given order, carrying `results`, `errors` and
 * `dropped` across to the new indices.
 *
 * Rekeying is the whole difficulty. `results`, `errors` and `dropped` are all keyed by
 * source index, so moving a source without moving its three companions silently pairs one
 * source's pages with another source's errors — and the pairing looks plausible enough to
 * survive review. Doing it in one place, once, is why this function exists rather than the
 * three-line loop it looks like it should be.
 */
const renumber = <S extends SourceLike, P>(
  plan: PagePlan<S, P>,
  ordered: S[],
): PagePlan<S, P> & { sources: S[] } => {
  const results: Record<string, P[]> = {}
  const errors: Record<string, string> = {}
  const dropped: string[] = []
  const sources = ordered.map((source, next) => {
    const from = String(source.idx)
    const to = String(next)
    const pages = plan.results?.[from]
    if (pages) results[to] = pages
    const error = plan.errors?.[from]
    if (error !== undefined) errors[to] = error
    for (const key of plan.dropped ?? [])
      if (key.startsWith(`${from}:`)) dropped.push(`${to}:${key.slice(from.length + 1)}`)
    return { ...source, idx: next }
  })
  return { ...plan, sources, results, errors, dropped }
}

/**
 * Reorder sources into `order`, a permutation of the current source indices.
 *
 * Throws on anything that is not a permutation — a repeated index, an unknown one, a short
 * list. A partial reorder would drop sources, and the pages of a dropped source vanish from
 * the flatten without ever being deleted, which reads as data loss rather than as the bad
 * request it is.
 */
export const reorderSources = <S extends SourceLike, P>(
  plan: PagePlan<S, P>,
  order: readonly number[],
): PagePlan<S, P> => {
  const byIdx = new Map(plan.sources.map((s) => [s.idx, s]))
  if (order.length !== plan.sources.length || new Set(order).size !== order.length)
    throw new Error('reorderSources: order must be a permutation of the current sources')
  const ordered = order.map((idx) => {
    const source = byIdx.get(idx)
    if (!source) throw new Error(`reorderSources: unknown source index ${idx}`)
    return source
  })
  return renumber(plan, ordered)
}

/**
 * Move the page at display position `from` to position `to`, the operation a drag in the
 * grid performs.
 *
 * Only whole sources move. Dragging one segment of a split strip out from among its
 * siblings would mean the source no longer describes a contiguous run of pages, and the
 * next run — which rebuilds those segments together, in order, from one original — would
 * put it straight back. Moving the source moves its segments as a block, which is the only
 * version of this that survives reprocessing.
 */
export const movePage = <S extends SourceLike, P>(
  plan: PagePlan<S, P>,
  from: number,
  to: number,
): PagePlan<S, P> => {
  const flat = flattenPages(plan)
  const moving = flat[from]
  const target = flat[to]
  if (!moving || !target) throw new Error('movePage: position out of range')
  const order = [...plan.sources].sort((a, b) => a.idx - b.idx).map((s) => s.idx)
  const at = order.indexOf(moving.source.idx)
  const dest = order.indexOf(target.source.idx)
  if (at < 0 || dest < 0 || at === dest) return plan
  order.splice(at, 1)
  order.splice(dest, 0, moving.source.idx)
  return reorderSources(plan, order)
}

/**
 * Delete pages by display position.
 *
 * A source whose every segment is deleted is removed outright, so it is not processed again
 * and its original stops being read. A source that keeps at least one segment stays, with
 * the deleted segments recorded in `dropped` — see the note at the top of this file for why
 * that record has to exist rather than just editing `results`.
 */
export const deletePages = <S extends SourceLike, P>(
  plan: PagePlan<S, P>,
  positions: readonly number[],
): PagePlan<S, P> => {
  const flat = flattenPages(plan)
  const targets = positions.map((p) => flat[p])
  if (targets.some((t) => !t)) throw new Error('deletePages: position out of range')
  const dropped = new Set(plan.dropped ?? [])
  for (const t of targets) if (t) dropped.add(pageRefKey(t.source.idx, t.segment))

  const survivors = plan.sources.filter((source) => {
    const total = plan.results?.[String(source.idx)]?.length ?? 0
    // A source with no results yet (still processing, or failed) is never swept away here:
    // it has no pages to have deleted, and removing it would discard a pending upload.
    if (total === 0) return true
    return [...Array(total).keys()].some((seg) => !dropped.has(pageRefKey(source.idx, seg)))
  })
  return renumber(
    { ...plan, dropped: [...dropped] },
    [...survivors].sort((a, b) => a.idx - b.idx),
  )
}
