'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, useToast } from '@palscans/ui'
import type { QueueItem } from '../server/queue'
import { Panel, PanelHeader } from '../ui'
import { postJson } from './api'
import { UploadQueue } from './UploadQueue'

export function JobsPanel({ items }: { items: QueueItem[] }) {
  const m = messages.admin.settings.jobs
  const { toast } = useToast()
  return (
    <Panel>
      <PanelHeader
        title={m.recent}
        aside={
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const res = await postJson<{ published: number[] }>(
                '/api/admin/jobs/run-scheduler',
                {},
              )
              if (!res.ok) return toast({ title: messages.admin.errorSaving, tone: 'danger' })
              toast({ title: fmt(m.schedulerRan, { n: res.data.published.length }), tone: 'ok' })
            }}
          >
            {m.runScheduler}
          </Button>
        }
      />
      <UploadQueue initial={items} />
    </Panel>
  )
}
