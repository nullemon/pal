'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { DatabaseBackup } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, postJson } from '@/components/admin/client/api'
import {
  EmptyRow,
  Panel,
  PanelHeader,
  Pill,
  type PillTone,
  Table,
  Td,
  Th,
} from '@/components/admin/ui'
import type { BackupRunView } from '../shared'
import { formatBytes, formatDuration } from '../shared'

/**
 * The "Backup now" control and the last run's outcome (docs/17 §G).
 *
 * Pressing the button only enqueues — the worker is the process that can take a dump — so
 * the panel then polls `/api/admin/backup` until the recorded run is newer than the one it
 * was showing. That is also the honest failure mode: if the worker is down, nothing new ever
 * arrives and the panel keeps showing the previous run rather than a fake success.
 */

const tones: Record<BackupRunView['status'], PillTone> = {
  ok: 'ok',
  failed: 'danger',
  skipped: 'warn',
}

const statusLabel = (status: BackupRunView['status']): string =>
  status === 'ok'
    ? adminMessages.backup.statusOk
    : status === 'failed'
      ? adminMessages.backup.statusFailed
      : adminMessages.backup.statusSkipped

/** Long enough for a dump of a real database, short enough that a dead worker is obvious. */
const POLL_MS = 3000
const POLL_FOR_MS = 10 * 60 * 1000

export function BackupPanel({ initial }: { initial: BackupRunView | null }) {
  const m = adminMessages.backup
  const { toast } = useToast()
  const [last, setLast] = useState(initial)
  const [running, setRunning] = useState(false)
  const startedAt = useRef(0)

  const poll = useCallback(async () => {
    const res = await api<BackupRunView | null>('/api/admin/backup')
    if (!res.ok || !res.data) return false
    // "Newer than what we had" is the only reliable signal that the worker finished ours.
    const seen = last?.finishedAt ?? ''
    if (res.data.finishedAt <= seen) return false
    setLast(res.data)
    toast({
      title: statusLabel(res.data.status),
      tone: res.data.status === 'ok' ? 'ok' : 'danger',
      ...(res.data.error ? { description: res.data.error } : {}),
    })
    return true
  }, [last?.finishedAt, toast])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      void poll().then((done) => {
        if (done || Date.now() - startedAt.current > POLL_FOR_MS) setRunning(false)
      })
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [running, poll])

  const start = async () => {
    setRunning(true)
    startedAt.current = Date.now()
    const res = await postJson<{ jobId: string; queue: string }>('/api/admin/backup', {})
    if (!res.ok) {
      setRunning(false)
      return toast({ title: m.queueFailed, tone: 'danger' })
    }
    toast({
      title: m.queued,
      tone: res.data.queue === 'memory' ? 'danger' : 'ok',
      ...(res.data.queue === 'memory' ? { description: m.memoryQueueWarning } : {}),
    })
  }

  return (
    <Panel>
      <PanelHeader
        title={m.lastRun}
        hint={m.workerNote}
        aside={
          <Button size="sm" variant="outline" disabled={running} onClick={() => void start()}>
            <DatabaseBackup size={14} aria-hidden="true" />
            {running ? m.queueing : m.runNow}
          </Button>
        }
      />
      <Table>
        <thead>
          <tr>
            <Th>{m.status}</Th>
            <Th>{m.lastRun}</Th>
            <Th>{m.trigger}</Th>
            <Th>{m.key}</Th>
            <Th align="right">{m.size}</Th>
            <Th align="right">{m.entries}</Th>
            <Th align="right">{m.duration}</Th>
          </tr>
        </thead>
        <tbody>
          {last === null ? (
            <EmptyRow colSpan={7}>{m.neverHint}</EmptyRow>
          ) : (
            <tr>
              <Td>
                <Pill tone={tones[last.status]}>{statusLabel(last.status)}</Pill>
              </Td>
              <Td className="whitespace-nowrap tabular-nums text-fg-muted">
                <time dateTime={last.finishedAt} title={last.finishedAt}>
                  {last.finishedAt.slice(0, 16).replace('T', ' ')}
                </time>
              </Td>
              <Td className="text-fg-muted">
                {last.trigger === 'manual' ? m.triggerManual : m.triggerSchedule}
              </Td>
              <Td className="max-w-[280px] truncate font-mono text-[12px]">{last.key ?? '—'}</Td>
              <Td align="right" className="tabular-nums">
                {formatBytes(last.bytes)}
              </Td>
              <Td align="right" className="tabular-nums">
                {last.entries ?? '—'}
              </Td>
              <Td align="right" className="tabular-nums text-fg-muted">
                {formatDuration(last.durationMs)}
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
      {last ? (
        <dl className="mt-3.5 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-[max-content_1fr]">
          <dt className="text-fg-muted">{m.destination}</dt>
          <dd className="font-mono text-[12px] break-all">{last.destination ?? '—'}</dd>
          <dt className="text-fg-muted">{m.retention}</dt>
          <dd>
            {last.pruned.length === 0 ? m.prunedNone : fmt(m.prunedSome, { n: last.pruned.length })}
          </dd>
          {last.error ? (
            <>
              <dt className="text-danger">{m.error}</dt>
              <dd className="text-danger break-words">{last.error}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </Panel>
  )
}
