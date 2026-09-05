'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { cn } from '@palscans/ui'
import { useEffect, useState } from 'react'
import type { QueueItem } from '../server/queue'
import { ChapterStatePill, EmptyRow, Num, Table, Td, Th } from '../ui'
import { postJson } from './api'
import { formatChapterNumber } from './util'

/** The queue view: `uploading → processing → ready` with page-level progress over SSE (docs/04). */
export function UploadQueue({ initial }: { initial: QueueItem[] }) {
  const [items, setItems] = useState(initial)
  const [live, setLive] = useState(false)
  const m = adminMessages.admin.upload.queue
  useEffect(() => {
    const es = new EventSource('/api/admin/jobs/stream')
    es.addEventListener('queue', (e) => {
      try {
        setItems(JSON.parse((e as MessageEvent<string>).data) as QueueItem[])
        setLive(true)
      } catch {
        // ignore malformed frames
      }
    })
    es.onopen = () => setLive(true)
    es.onerror = () => setLive(false)
    return () => es.close()
  }, [])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">
        <span
          className={cn('size-2 rounded-full', live ? 'bg-ok' : 'bg-warn')}
          aria-hidden="true"
        />
        {live ? m.connected : m.reconnecting}
      </div>
      <Table>
        <thead>
          <tr>
            <Th>{adminMessages.admin.chapters.colChapter}</Th>
            <Th>{adminMessages.admin.chapters.colSeries}</Th>
            <Th>{adminMessages.admin.chapters.colState}</Th>
            <Th>{adminMessages.admin.chapters.colPages}</Th>
            <Th>{adminMessages.admin.actions}</Th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? <EmptyRow colSpan={5}>{m.empty}</EmptyRow> : null}
          {items.map((it) => {
            const errors = Object.entries(it.errors)
            const pct = it.total ? Math.round((it.done / it.total) * 100) : 0
            return (
              <tr key={it.id}>
                <Td className="font-semibold">
                  <a
                    href={`/admin/series/${it.seriesId}?tab=chapters`}
                    className="hover:text-brand-hover"
                  >
                    Ch. {formatChapterNumber(it.number)}
                  </a>
                </Td>
                <Td className="max-w-[240px] truncate text-fg-muted">{it.seriesTitle}</Td>
                <Td>
                  <ChapterStatePill state={it.state} />
                  {it.attempt > 1 ? (
                    <span className="ml-2 text-[11px] text-fg-subtle">#{it.attempt}</span>
                  ) : null}
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className={cn(
                          'h-full transition-[width]',
                          it.state === 'failed' ? 'bg-danger' : 'bg-brand',
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <Num className="text-[12px] text-fg-muted">
                      {fmt(adminMessages.admin.dashboard.pagesDone, {
                        done: it.done,
                        total: it.total,
                      })}
                    </Num>
                  </div>
                  {errors.length ? (
                    <ul className="mt-1 text-[11px] text-danger">
                      {errors.slice(0, 3).map(([idx, msg]) => (
                        <li key={idx}>
                          #{Number(idx) + 1}: {msg}
                        </li>
                      ))}
                      {errors.length > 3 ? <li>+{errors.length - 3}</li> : null}
                    </ul>
                  ) : null}
                </Td>
                <Td>
                  {it.state === 'failed' ? (
                    <button
                      type="button"
                      className="inline-flex h-7 items-center rounded-md border border-line px-2 text-[12px] font-semibold hover:bg-surface-2"
                      onClick={() =>
                        void postJson(`/api/admin/chapters/${it.id}/retry`, { failedOnly: true })
                      }
                    >
                      {adminMessages.admin.chapters.retryFailed}
                    </button>
                  ) : null}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}
