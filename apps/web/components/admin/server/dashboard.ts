import { getQueue } from '@palscans/core/queue'
import {
  chapters,
  executeRows,
  getDb,
  reports,
  series,
  seriesStatsDaily,
  subscriptions,
  users,
} from '@palscans/db'
import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'

export interface DashboardData {
  viewsToday: number
  viewsLastWeek: number
  sparkline: number[]
  newUsers: number
  chaptersPublished: number
  activeSubscriptions: number
  openReports: number
  failedJobs: number
  queue: {
    kind: string
    waiting: number
    active: number
    failed: number
    completed: number
    delayed: number
  } | null
  scheduled: Array<{
    id: number
    number: number
    title: string | null
    publishedAt: Date | null
    seriesId: number
    seriesTitle: string
    seriesSlug: string
  }>
  jobs: Array<{
    id: number
    number: number
    state: string
    seriesId: number
    seriesTitle: string
    pageCount: number
    done: number
    total: number
    errors: number
    updatedAt: Date
  }>
}

const dayStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

export const loadDashboard = async (now = new Date()): Promise<DashboardData> => {
  const db = await getDb()
  const today = dayStart(now)
  const lastWeek = new Date(today.getTime() - 7 * 86_400_000)
  const twoWeeks = new Date(today.getTime() - 13 * 86_400_000)

  const [daily, [nu], [cp], [subs], [rep], [failed], scheduled, jobRows] = await Promise.all([
    executeRows<{ bucket: string; views: number }>(
      db,
      sql`select bucket::text as bucket, coalesce(sum(views), 0)::int as views from ${seriesStatsDaily} where bucket >= ${isoDate(twoWeeks)} group by bucket order by bucket`,
    ),
    db
      .select({ n: count() })
      .from(users)
      .where(and(gte(users.createdAt, today), isNull(users.deletedAt))),
    db
      .select({ n: count() })
      .from(chapters)
      .where(
        and(
          eq(chapters.state, 'published'),
          gte(chapters.publishedAt, today),
          isNull(chapters.deletedAt),
        ),
      ),
    db
      .select({ n: count() })
      .from(subscriptions)
      .where(inArray(subscriptions.status, ['active', 'trialing', 'past_due'])),
    db.select({ n: count() }).from(reports).where(eq(reports.status, 'open')),
    db
      .select({ n: count() })
      .from(chapters)
      .where(and(eq(chapters.state, 'failed'), isNull(chapters.deletedAt))),
    db
      .select({
        id: chapters.id,
        number: chapters.number,
        title: chapters.title,
        publishedAt: chapters.publishedAt,
        seriesId: chapters.seriesId,
        seriesTitle: series.title,
        seriesSlug: series.slug,
      })
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(and(eq(chapters.state, 'scheduled'), isNull(chapters.deletedAt)))
      .orderBy(asc(chapters.publishedAt))
      .limit(10),
    db
      .select({
        id: chapters.id,
        number: chapters.number,
        state: chapters.state,
        seriesId: chapters.seriesId,
        seriesTitle: series.title,
        pageCount: chapters.pageCount,
        processing: chapters.processing,
        updatedAt: chapters.updatedAt,
      })
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(
        and(
          isNull(chapters.deletedAt),
          sql`(${chapters.state} in ('processing', 'failed') or (${chapters.state} = 'ready' and ${chapters.updatedAt} > now() - interval '1 day'))`,
        ),
      )
      .orderBy(desc(chapters.updatedAt))
      .limit(15),
  ])

  const byDay = new Map(daily.map((r) => [r.bucket, Number(r.views)]))
  const sparkline: number[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000)
    sparkline.push(byDay.get(isoDate(d)) ?? 0)
  }

  let queue: DashboardData['queue'] = null
  try {
    const q = await getQueue()
    const s = await q.stats()
    queue = { kind: q.kind, ...s }
  } catch {
    queue = null
  }

  return {
    viewsToday: byDay.get(isoDate(today)) ?? 0,
    viewsLastWeek: byDay.get(isoDate(lastWeek)) ?? 0,
    sparkline,
    newUsers: nu?.n ?? 0,
    chaptersPublished: cp?.n ?? 0,
    activeSubscriptions: subs?.n ?? 0,
    openReports: rep?.n ?? 0,
    failedJobs: failed?.n ?? 0,
    queue,
    scheduled,
    jobs: jobRows.map((r) => ({
      id: r.id,
      number: r.number,
      state: r.state,
      seriesId: r.seriesId,
      seriesTitle: r.seriesTitle,
      pageCount: r.pageCount,
      done: r.processing?.progress.done ?? 0,
      total: r.processing?.progress.total ?? r.pageCount,
      errors: Object.keys(r.processing?.errors ?? {}).length,
      updatedAt: r.updatedAt,
    })),
  }
}
