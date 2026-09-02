import { chapters, getDb, series } from '@palscans/db'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

/** Snapshot of chapters in (or recently through) the pipeline, for the SSE stream and the Jobs page. */
export interface QueueItem {
  id: number
  seriesId: number
  seriesTitle: string
  number: number
  state: string
  done: number
  total: number
  errors: Record<string, string>
  attempt: number
  updatedAt: string
}

export const loadQueue = async (): Promise<QueueItem[]> => {
  const db = await getDb()
  const rows = await db
    .select({
      id: chapters.id,
      seriesId: chapters.seriesId,
      seriesTitle: series.title,
      number: chapters.number,
      state: chapters.state,
      processing: chapters.processing,
      pageCount: chapters.pageCount,
      updatedAt: chapters.updatedAt,
    })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(
        isNull(chapters.deletedAt),
        sql`(${chapters.state} in ('processing', 'failed') or (${chapters.processing} is not null and ${chapters.updatedAt} > now() - interval '6 hours'))`,
      ),
    )
    .orderBy(desc(chapters.updatedAt))
    .limit(50)
  return rows.map((r) => ({
    id: r.id,
    seriesId: r.seriesId,
    seriesTitle: r.seriesTitle,
    number: r.number,
    state: r.state,
    done: r.processing?.progress.done ?? r.pageCount,
    total: r.processing?.progress.total ?? r.pageCount,
    errors: r.processing?.errors ?? {},
    attempt: r.processing?.attempt ?? 0,
    updatedAt: r.updatedAt.toISOString(),
  }))
}
