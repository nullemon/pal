import { messages } from '@palscans/core/messages'
import { getQueue } from '@palscans/core/queue'
import { JobsPanel } from '@/components/admin/client/JobsPanel'
import { loadQueue } from '@/components/admin/server/queue'
import { PageHeader, Panel, PanelHeader, StatTile } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { getEnv } from '@/lib/env'

export default async function JobsPage() {
  await withPermission('chapter.update', { returnTo: '/admin/jobs' })
  const m = messages.admin.settings.jobs
  const d = messages.admin.dashboard
  let stats: {
    kind: string
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
  } | null = null
  try {
    const q = await getQueue()
    stats = { kind: q.kind, ...(await q.stats()) }
  } catch {
    stats = null
  }
  const items = await loadQueue()
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <Panel>
        <PanelHeader
          title={m.queue}
          aside={
            <span>
              {m.kind}: {stats?.kind ?? '—'} · Redis {getEnv().REDIS_URL ? 'on' : 'off'}
            </span>
          }
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label={d.waiting} value={stats?.waiting ?? '—'} />
          <StatTile label={d.active} value={stats?.active ?? '—'} />
          <StatTile label={d.delayed} value={stats?.delayed ?? '—'} />
          <StatTile label={d.completed} value={stats?.completed ?? '—'} />
          <StatTile
            label={d.failed}
            value={stats?.failed ?? '—'}
            tone={stats && stats.failed > 0 ? 'danger' : undefined}
          />
        </div>
      </Panel>
      <JobsPanel items={items} />
    </>
  )
}
