import 'server-only'
import { chapters, getDb, series, takedowns } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'

/**
 * The `/dmca` form's other half (docs/02 + docs/07 "Content compliance"): besides the
 * `reports` row that puts the notice in the moderation queue, every notice is recorded in
 * `takedowns` — the ledger a safe-harbour claim is argued from, and the queue
 * `Admin → Community → Takedowns` works through.
 *
 * Two rows rather than one, on purpose: `reports` is the operational inbox that DMCA shares
 * with broken-chapter and contact tickets and that gets triaged and forgotten, while
 * `takedowns` is the permanent legal record with the SLA clock and the outcome on it. The
 * report carries `payload.takedown_id` so the two are never orphaned from each other.
 */

/** `/series/<slug>/chapter-<n>` in a notice URL → the chapter, so the ticket names it exactly. */
export async function chapterTargetFor(
  urls: readonly string[],
): Promise<{ id: number; number: number; seriesId: number } | null> {
  const db = await getDb()
  for (const raw of urls) {
    const m = /\/series\/([a-z0-9-]+)\/chapter-(\d+(?:\.\d+)?)/i.exec(raw)
    if (!m?.[1] || !m[2]) continue
    const [row] = await db
      .select({ id: chapters.id, number: chapters.number, seriesId: chapters.seriesId })
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(
        and(
          eq(series.slug, m[1].toLowerCase()),
          eq(chapters.number, Number(m[2])),
          isNull(chapters.deletedAt),
        ),
      )
      .limit(1)
    if (row) return row
  }
  return null
}

export interface TakedownNotice {
  claimant: string
  claimantEmail: string
  /** Free text: the work described, the URLs complained of, and the sworn statements. */
  noticeBody: string
  seriesId: number | null
  chapterId: number | null
}

/** Insert the notice. Returns the ticket number the claimant is given. */
export async function recordTakedown(notice: TakedownNotice): Promise<number> {
  const db = await getDb()
  const [row] = await db
    .insert(takedowns)
    .values({
      claimant: notice.claimant,
      claimantEmail: notice.claimantEmail,
      noticeBody: notice.noticeBody,
      seriesId: notice.seriesId,
      chapterId: notice.chapterId,
    })
    .returning({ id: takedowns.id })
  if (!row) throw new Error('takedown insert returned no row')
  return row.id
}

/** The notice as one auditable block of text, in the order §512(c)(3) asks for it. */
export const noticeBodyFor = (v: {
  work: string
  urls: readonly string[]
  signature: string
}): string =>
  [
    'Copyrighted work:',
    v.work,
    '',
    'Infringing URLs:',
    ...v.urls,
    '',
    `Good-faith belief: affirmed. Accuracy and authority, under penalty of perjury: affirmed.`,
    `Electronic signature: ${v.signature}`,
  ].join('\n')
