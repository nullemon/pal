import { can } from '@palscans/core'
import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import {
  getDb,
  loadModerationMetrics,
  MODERATION_WINDOWS,
  parseModerationWindow,
} from '@palscans/db'
import { cn } from '@palscans/ui'
import { first, type SearchParams } from '@/components/admin/server/params'
import { Hint, PageHeader, Panel, PanelHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import {
  AgePanel,
  ByKindPanel,
  DepthRow,
  LatencyPanels,
  ModeratorsPanel,
  OldestPanel,
} from './panels'
import { QueueFlowChart } from './QueueFlowChart'

/**
 * `Admin → Community → Queue health` (docs/04 "Community", docs/14 §3, docs/07 SLA).
 *
 * Permission: **`report.handle`**, the same gate `/admin/reports` and `/admin/takedowns`
 * already use. It is the closest existing permission by audience — this screen measures the
 * three queues those two screens work, so anyone allowed to work them is allowed to see how
 * far behind they are. `audit.read` would have been wrong: it is admin-only, and hiding the
 * backlog from the moderators responsible for it is the opposite of the point.
 *
 * The one part that is not queue state is "actions per moderator", which is the audit log
 * aggregated per person. That keeps the audit log's own gate: an `audit.read` holder sees
 * every moderator, and everyone else sees their own row. No new permission is introduced —
 * the panel composes the two that already exist.
 */
export default async function ModerationHealthPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await withPermission('report.handle', { returnTo: '/admin/moderation' })
  const days = parseModerationWindow(first((await searchParams).window))
  const now = new Date()
  const db = await getDb()
  const metrics = await loadModerationMetrics(db, days, now)
  const m = adminMessages.queueHealth

  const opened = metrics.flow.reduce((t, p) => t + p.opened, 0)
  const resolved = metrics.flow.reduce((t, p) => t + p.resolved, 0)
  const net = opened - resolved
  const netLine =
    opened === 0 && resolved === 0
      ? m.flowEmpty
      : net > 0
        ? fmt(m.netGrew, { n: net })
        : net < 0
          ? fmt(m.netShrank, { n: -net })
          : m.netLevel

  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <OldestPanel stale={metrics.stale} />
      <DepthRow depths={metrics.depths} />
      <div className="grid items-start gap-3.5 xl:grid-cols-[1fr_420px]">
        <AgePanel ages={metrics.ages} />
        <ByKindPanel ages={metrics.ages} />
      </div>

      {/* One row of presets, above everything they scope and nothing they do not. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[12px] font-medium leading-4 text-fg-muted">{m.window}</span>
        <div className="inline-flex rounded-md border border-line bg-surface-1 p-0.5">
          {MODERATION_WINDOWS.map((option) => (
            <a
              key={option}
              href={`/admin/moderation?window=${option}`}
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

      <LatencyPanels metrics={metrics} />

      <Panel>
        <PanelHeader
          title={m.flowTitle}
          hint={m.flowHint}
          aside={
            <span className={cn('tabular-nums', net > 0 && 'text-warn', net < 0 && 'text-ok')}>
              {netLine}
            </span>
          }
        />
        <QueueFlowChart points={metrics.flow} />
      </Panel>

      <ModeratorsPanel
        rows={metrics.moderators}
        full={can(user, 'audit.read')}
        viewerId={user.id}
        days={days}
      />
    </>
  )
}
