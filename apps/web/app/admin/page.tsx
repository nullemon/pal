import { compactNumber, countdown, formatChapterNumber } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import { loadDashboard } from '@/components/admin/server/dashboard'
import {
  ChapterStatePill,
  EmptyRow,
  Num,
  PageHeader,
  Panel,
  PanelHeader,
  StatTile,
  Table,
  Td,
  Th,
  When,
} from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  const w = 120
  const h = 28
  const step = values.length > 1 ? w / (values.length - 1) : w
  const points = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`,
  )
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="mt-1 block">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="var(--color-brand-hover)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default async function AdminDashboardPage() {
  // docs/16: the layout is not an auth boundary — every page guards itself.
  await withPermission('admin.access', { returnTo: '/admin' })
  const d = await loadDashboard()
  const m = messages.admin.dashboard
  const now = new Date()
  const delta =
    d.viewsLastWeek > 0
      ? Math.round(((d.viewsToday - d.viewsLastWeek) / d.viewsLastWeek) * 100)
      : null
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label={m.viewsToday}
          value={compactNumber(d.viewsToday)}
          delta={
            <>
              {delta !== null ? (
                <span className={delta >= 0 ? 'text-ok' : 'text-danger'}>
                  {delta >= 0 ? '+' : ''}
                  {delta}%
                </span>
              ) : (
                '—'
              )}{' '}
              {m.vsLastWeek}
              <Sparkline values={d.sparkline} />
            </>
          }
        />
        <StatTile label={m.newUsers} value={d.newUsers} hint={m.today} href="/admin/users" />
        <StatTile
          label={m.chaptersPublished}
          value={d.chaptersPublished}
          hint={m.today}
          href="/admin/chapters"
        />
        <StatTile label={m.activeSubscriptions} value={d.activeSubscriptions} />
        <StatTile
          label={m.openReports}
          value={d.openReports}
          tone={d.openReports > 0 ? 'danger' : undefined}
          href="/admin/reports"
        />
        <StatTile
          label={m.failedJobs}
          value={d.failedJobs}
          tone={d.failedJobs > 0 ? 'danger' : undefined}
          href="/admin/jobs"
        />
      </div>
      <div className="grid gap-3.5 xl:grid-cols-[1fr_420px]">
        <Panel className="p-0 md:px-0">
          <div className="px-5 pt-4">
            <PanelHeader
              title={m.jobQueue}
              hint={m.jobQueueHint}
              aside={
                d.queue ? (
                  <span className="tabular-nums">
                    {d.queue.kind} · {m.waiting} {d.queue.waiting} · {m.active} {d.queue.active} ·{' '}
                    <span className={d.queue.failed > 0 ? 'text-danger' : undefined}>
                      {m.failed} {d.queue.failed}
                    </span>
                  </span>
                ) : null
              }
            />
          </div>
          <Table className="rounded-none border-0 border-t">
            <thead>
              <tr>
                <Th>{messages.admin.chapters.colChapter}</Th>
                <Th>{messages.admin.chapters.colSeries}</Th>
                <Th>{messages.admin.chapters.colState}</Th>
                <Th>{messages.admin.chapters.colPages}</Th>
                <Th align="right">{messages.admin.series.colUpdated}</Th>
              </tr>
            </thead>
            <tbody>
              {d.jobs.length === 0 ? <EmptyRow colSpan={5}>{m.queueIdle}</EmptyRow> : null}
              {d.jobs.map((j) => (
                <tr key={j.id}>
                  <Td>
                    <a
                      href={`/admin/series/${j.seriesId}?tab=chapters`}
                      className="font-semibold hover:text-brand-hover"
                    >
                      Ch. {formatChapterNumber(j.number)}
                    </a>
                  </Td>
                  <Td className="max-w-[240px] truncate text-fg-muted">{j.seriesTitle}</Td>
                  <Td>
                    <ChapterStatePill state={j.state} />
                    {j.errors > 0 ? (
                      <span className="ml-2 text-[12px] text-danger">
                        {fmt(messages.admin.chapters.pageErrors, { n: j.errors })}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full bg-brand"
                          style={{
                            width: `${j.total ? Math.round((j.done / j.total) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <Num className="text-[12px] text-fg-muted">
                        {fmt(m.pagesDone, { done: j.done, total: j.total })}
                      </Num>
                    </div>
                  </Td>
                  <Td align="right" className="text-fg-muted">
                    <When date={j.updatedAt} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
        <Panel className="p-0 md:px-0">
          <div className="px-5 pt-4">
            <PanelHeader title={m.nextScheduled} hint={m.nextScheduledHint} />
          </div>
          <Table className="rounded-none border-0 border-t">
            <thead>
              <tr>
                <Th>{messages.admin.chapters.colChapter}</Th>
                <Th>{messages.admin.chapters.colSeries}</Th>
                <Th align="right">{messages.admin.chapters.colPublished}</Th>
              </tr>
            </thead>
            <tbody>
              {d.scheduled.length === 0 ? (
                <EmptyRow colSpan={3}>{m.nothingScheduled}</EmptyRow>
              ) : null}
              {d.scheduled.map((c) => (
                <tr key={c.id}>
                  <Td className="font-semibold">Ch. {formatChapterNumber(c.number)}</Td>
                  <Td className="max-w-[180px] truncate text-fg-muted">
                    <a
                      href={`/admin/series/${c.seriesId}?tab=chapters`}
                      className="hover:text-brand-hover"
                    >
                      {c.seriesTitle}
                    </a>
                  </Td>
                  <Td align="right">
                    {c.publishedAt ? (
                      <span className="text-fg-muted">
                        <span className="font-semibold text-gold">
                          {fmt(m.in, { time: countdown(c.publishedAt, now) })}
                        </span>{' '}
                        <When date={c.publishedAt} className="text-[12px]" />
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
    </>
  )
}
