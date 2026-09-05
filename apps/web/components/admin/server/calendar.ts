import { chapters, getDb, series } from '@palscans/db'
import { and, asc, count, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm'

/**
 * The release calendar's reads (docs/04 "Scheduling"). Two questions, both cheap: what
 * carries a date inside the visible range, and what is finished but has no date at all —
 * the second one being the group that costs money for every day it sits there.
 *
 * Writes are not here on purpose: moving a chapter goes through the same
 * `/api/admin/chapters/bulk` transitions the bulk bar uses, which carry the early-access
 * window and the notification fan-out.
 */

export interface CalendarChapter {
  id: number
  seriesId: number
  seriesTitle: string
  seriesSlug: string
  number: number
  title: string | null
  state: string
  isPremium: boolean
  /** ISO instant; null only for the ready backlog. */
  publishedAt: string | null
  earlyAccessUntil: string | null
  pageCount: number
}

export interface CalendarData {
  dated: CalendarChapter[]
  backlog: CalendarChapter[]
  backlogTotal: number
}

const columns = {
  id: chapters.id,
  seriesId: chapters.seriesId,
  seriesTitle: series.title,
  seriesSlug: series.slug,
  number: chapters.number,
  title: chapters.title,
  state: chapters.state,
  isPremium: chapters.isPremium,
  publishedAt: chapters.publishedAt,
  earlyAccessUntil: chapters.earlyAccessUntil,
  pageCount: chapters.pageCount,
}

interface Row extends Omit<CalendarChapter, 'publishedAt' | 'earlyAccessUntil'> {
  publishedAt: Date | null
  earlyAccessUntil: Date | null
}

const toChapter = (row: Row): CalendarChapter => ({
  ...row,
  publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  earlyAccessUntil: row.earlyAccessUntil ? row.earlyAccessUntil.toISOString() : null,
})

/** How many undated `ready` chapters the rail lists before it just counts them. */
export const BACKLOG_LIMIT = 40

export const loadCalendar = async (
  from: Date,
  to: Date,
  seriesId?: number,
): Promise<CalendarData> => {
  const db = await getDb()
  const seriesFilter = seriesId ? eq(chapters.seriesId, seriesId) : undefined
  const [dated, backlog, [total]] = await Promise.all([
    db
      .select(columns)
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(
        and(
          isNull(chapters.deletedAt),
          inArray(chapters.state, ['scheduled', 'published']),
          gte(chapters.publishedAt, from),
          lt(chapters.publishedAt, to),
          seriesFilter,
        ),
      )
      .orderBy(asc(chapters.publishedAt))
      .limit(1000),
    db
      .select(columns)
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(
        and(
          isNull(chapters.deletedAt),
          eq(chapters.state, 'ready'),
          isNull(chapters.publishedAt),
          seriesFilter,
        ),
      )
      .orderBy(desc(chapters.updatedAt))
      .limit(BACKLOG_LIMIT),
    db
      .select({ n: count() })
      .from(chapters)
      .where(
        and(
          isNull(chapters.deletedAt),
          eq(chapters.state, 'ready'),
          isNull(chapters.publishedAt),
          seriesFilter,
        ),
      ),
  ])
  return {
    dated: dated.map(toChapter),
    backlog: backlog.map(toChapter),
    backlogTotal: total?.n ?? 0,
  }
}
