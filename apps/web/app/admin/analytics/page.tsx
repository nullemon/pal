import { adminMessages } from '@palscans/core/messages/admin'
import {
  analyticsWindow,
  getDb,
  parseAnalyticsWindow,
  topChaptersByViews,
  topSeriesByViews,
  viewsByDay,
  viewTotals,
} from '@palscans/db'
import {
  TopChaptersPanel,
  TopSeriesPanel,
  TotalsRow,
  ViewsOverTime,
  WindowFilter,
} from '@/components/admin/analytics/panels'
import { first, type SearchParams } from '@/components/admin/server/params'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

/**
 * `Admin → System → Analytics` (docs/13 "Analytics": the first-party views dashboard).
 *
 * Everything on the screen comes from `series_stats_daily` / `chapter_stats_daily` — the
 * per-day totals the `stats.rollup` job writes — and from the counters that same job keeps.
 * `view_events` is never read here: it holds one row per viewer per chapter per day for
 * ninety days, and no page render has any business scanning it.
 *
 * The window lives in the URL rather than in client state, so the four queries below run
 * once per request, every view of the screen is a link someone can send, and the chart, the
 * two tables and the header all describe the same slice by construction.
 */
export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await withPermission('settings.write', { returnTo: '/admin/analytics' })
  const days = parseAnalyticsWindow(first((await searchParams).window))
  const now = new Date()
  const range = analyticsWindow(days, now)
  const db = await getDb()
  const [points, totals, series, chapters] = await Promise.all([
    viewsByDay(db, range),
    viewTotals(db, now),
    topSeriesByViews(db, range, 10),
    topChaptersByViews(db, range, 10),
  ])
  const m = adminMessages.admin.analytics
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <TotalsRow totals={totals} />
      <WindowFilter days={days} hrefFor={(n) => `/admin/analytics?window=${n}`} />
      <ViewsOverTime points={points} range={range} />
      <div className="grid gap-3.5 xl:grid-cols-2">
        <TopSeriesPanel rows={series} />
        <TopChaptersPanel rows={chapters} />
      </div>
    </>
  )
}
