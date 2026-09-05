import { chapterLabel, compactNumber } from '@palscans/core'
import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import type { BucketRange, TopChapterRow, TopSeriesRow, ViewTotals } from '@palscans/db'
import { ANALYTICS_WINDOWS } from '@palscans/db'
import { cn } from '@palscans/ui'
import {
  EmptyRow,
  Hint,
  Num,
  Panel,
  PanelHeader,
  PubStatePill,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/admin/ui'
import { type ChartPoint, groupDigits, summarise } from './chart'
import { ViewsChart } from './ViewsChart'

/**
 * The pieces of `/admin/analytics`. All server components except the chart itself — the
 * window is a link, not a control, so the whole screen is one render with no client state
 * to keep in sync and a shareable URL for every view.
 */

const m = adminMessages.admin.analytics

/**
 * The fixed-period totals. Deliberately above the window filter: these four never change
 * with it, and a filter has to sit above only what it actually scopes.
 */
export function TotalsRow({ totals }: { totals: ViewTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile
        label={m.today}
        value={compactNumber(totals.today)}
        hint={groupDigits(totals.today)}
      />
      <StatTile
        label={m.last7}
        value={compactNumber(totals.week)}
        hint={groupDigits(totals.week)}
      />
      <StatTile
        label={m.last30}
        value={compactNumber(totals.month)}
        hint={groupDigits(totals.month)}
      />
      <StatTile
        label={m.allTime}
        value={compactNumber(totals.allTime)}
        hint={groupDigits(totals.allTime)}
        delta={m.allTimeHint}
      />
    </div>
  )
}

/** One row of presets, above everything they scope (chart and both tables). */
export function WindowFilter({
  days,
  hrefFor,
}: {
  days: number
  hrefFor: (days: number) => string
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[12px] font-medium leading-4 text-fg-muted">{m.window}</span>
      <div className="inline-flex rounded-md border border-line bg-surface-1 p-0.5">
        {ANALYTICS_WINDOWS.map((option) => (
          <a
            key={option}
            href={hrefFor(option)}
            aria-current={option === days ? 'true' : undefined}
            className={cn(
              'inline-flex h-7 items-center rounded-[5px] px-3 text-[12.5px] font-semibold tabular-nums transition-colors',
              option === days
                ? 'bg-brand-wash text-fg'
                : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {fmt(m.windowDays, { n: option })}
          </a>
        ))}
      </div>
      <Hint className="text-[12.5px]">{m.windowHint}</Hint>
    </div>
  )
}

/** Total, daily average and peak for the selected window. */
function WindowNumbers({
  summary,
  className,
}: {
  summary: ReturnType<typeof summarise>
  className?: string
}) {
  const { total, average, peak } = summary
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] leading-[18px] text-fg-muted tabular-nums',
        className,
      )}
    >
      <span>{fmt(m.windowTotal, { views: groupDigits(total) })}</span>
      <span>{fmt(m.dailyAverage, { views: groupDigits(average) })}</span>
      {peak && peak.views > 0 ? (
        <span>{fmt(m.peak, { views: groupDigits(peak.views), date: peak.bucket })}</span>
      ) : null}
    </div>
  )
}

/**
 * Views over time. The chart carries the shape; the table under it carries every number the
 * chart draws, so nothing is only reachable by hovering.
 */
export function ViewsOverTime({ points, range }: { points: ChartPoint[]; range: BucketRange }) {
  const summary = summarise(points)
  const { total } = summary
  return (
    <Panel>
      <PanelHeader
        title={m.overTime}
        hint={fmt(m.overTimeRange, { from: range.from, to: range.to })}
        // The header's aside never shrinks, so on a narrow screen the same three numbers go
        // under it and wrap instead of pushing the whole panel past the viewport.
        aside={<WindowNumbers summary={summary} className="hidden justify-end md:flex" />}
      />
      <WindowNumbers summary={summary} className="-mt-2 mb-3 md:hidden" />
      {total === 0 ? <Hint className="mb-3">{m.chartEmpty}</Hint> : null}
      <ViewsChart points={points} />
      <details className="mt-3 border-line-soft border-t pt-3">
        <summary className="cursor-pointer text-[12.5px] font-semibold text-fg-muted hover:text-fg">
          {m.tableView}
        </summary>
        <div className="mt-2.5 max-h-[320px] overflow-y-auto">
          <Table>
            <thead className="sticky top-0 bg-surface-1">
              <tr>
                <Th>{m.colDay}</Th>
                <Th align="right">{m.colViews}</Th>
                <Th align="right">{m.colShare}</Th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.bucket}>
                  <Td className="tabular-nums">{p.bucket}</Td>
                  <Td align="right">
                    <Num>{groupDigits(p.views)}</Num>
                  </Td>
                  <Td align="right" className="text-fg-muted">
                    <Num>{total > 0 ? `${((p.views / total) * 100).toFixed(1)}%` : '—'}</Num>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </details>
      <Hint className="mt-2.5 text-[12px]">{m.rollupHint}</Hint>
    </Panel>
  )
}

/**
 * A magnitude bar for a table row: one hue for every row — the length is the data, never a
 * ramp by rank. `aria-hidden` because the number it draws is in the very next cell, so a
 * screen reader would otherwise hear the same value announced twice.
 */
function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div
      aria-hidden="true"
      className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-surface-3"
    >
      <div className="h-full rounded-full bg-brand-hover" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function TopSeriesPanel({ rows }: { rows: TopSeriesRow[] }) {
  const max = rows[0]?.views ?? 0
  return (
    <Panel className="min-w-0 p-0 md:px-0">
      <div className="px-4 pt-4 md:px-5">
        <PanelHeader title={m.topSeries} hint={m.topSeriesHint} />
      </div>
      <Table className="rounded-none border-0 border-t">
        <thead>
          <tr>
            <Th className="w-8">{m.colRank}</Th>
            <Th>{m.colSeries}</Th>
            <Th className="w-[26%]" />
            <Th align="right">{m.colWindowViews}</Th>
            <Th align="right">{m.colAllTimeViews}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={5}>{m.noSeries}</EmptyRow> : null}
          {rows.map((row, i) => (
            <tr key={row.id}>
              <Td className="text-fg-subtle tabular-nums">{i + 1}</Td>
              <Td className="max-w-[260px]">
                <a
                  href={`/admin/series/${row.id}`}
                  className="font-semibold hover:text-brand-hover"
                  title={row.title}
                >
                  <span className="line-clamp-1">{row.title}</span>
                </a>
                {row.state === 'published' ? null : (
                  <span className="mt-0.5 block">
                    <PubStatePill state={row.state} />
                  </span>
                )}
              </Td>
              <Td>
                <Bar value={row.views} max={max} />
              </Td>
              <Td align="right" className="font-semibold">
                <Num>{groupDigits(row.views)}</Num>
              </Td>
              <Td align="right" className="text-fg-muted">
                <Num>{compactNumber(row.viewCount)}</Num>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  )
}

export function TopChaptersPanel({ rows }: { rows: TopChapterRow[] }) {
  const max = rows[0]?.views ?? 0
  return (
    <Panel className="min-w-0 p-0 md:px-0">
      <div className="px-4 pt-4 md:px-5">
        <PanelHeader title={m.topChapters} hint={m.topChaptersHint} />
      </div>
      <Table className="rounded-none border-0 border-t">
        <thead>
          <tr>
            <Th className="w-8">{m.colRank}</Th>
            <Th>{m.colChapter}</Th>
            <Th>{m.colSeries}</Th>
            <Th className="w-[22%]" />
            <Th align="right">{m.colWindowViews}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={5}>{m.noChapters}</EmptyRow> : null}
          {rows.map((row, i) => (
            <tr key={row.id}>
              <Td className="text-fg-subtle tabular-nums">{i + 1}</Td>
              <Td>
                <a
                  href={`/admin/chapters?chapter=${row.id}`}
                  className="font-semibold whitespace-nowrap hover:text-brand-hover"
                >
                  {chapterLabel(row.number)}
                </a>
              </Td>
              <Td className="max-w-[220px] text-fg-muted">
                <a
                  href={`/admin/series/${row.seriesId}`}
                  className="hover:text-brand-hover"
                  title={row.seriesTitle}
                >
                  <span className="line-clamp-1">{row.seriesTitle}</span>
                </a>
              </Td>
              <Td>
                <Bar value={row.views} max={max} />
              </Td>
              <Td align="right" className="font-semibold">
                <Num>{groupDigits(row.views)}</Num>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  )
}
