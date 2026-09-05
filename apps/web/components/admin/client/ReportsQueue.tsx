'use client'

import { adminMessages } from '@palscans/core/messages/admin'
import { Button, cn, useToast } from '@palscans/ui'
import { useCallback, useEffect, useState } from 'react'
import { Pill, selectClass } from '../ui'
import { postJson } from './api'
import { relativeTime } from './util'

interface Item {
  id: number
  kind: string
  targetType: string
  targetId: number | null
  reason: string
  detail: string | null
  payload: Record<string, unknown> | null
  status: string
  createdAt: string
  reporter: string | null
  reporterEmail: string | null
}

const targetHref = (r: Item): string | null => {
  if (!r.targetId) return null
  if (r.targetType === 'comment') return `/admin/comments?tab=reported`
  if (r.targetType === 'series') return `/admin/series/${r.targetId}`
  if (r.targetType === 'chapter') return `/admin/chapters?chapter=${r.targetId}`
  if (r.targetType === 'user') return `/admin/users/${r.targetId}`
  return null
}

/** docs/04 "Reports": one queue with a kind filter; j/k move, a action, d dismiss. */
export function ReportsQueue({
  kind,
  status,
  items,
}: {
  kind: string
  status: string
  items: Item[]
}) {
  const m = adminMessages.admin.reportsQueue
  const { toast } = useToast()
  const [rows, setRows] = useState(items)
  const [cursor, setCursor] = useState(0)
  const now = new Date()

  const act = useCallback(
    async (id: number, action: 'dismiss' | 'actioned' | 'triaged') => {
      const res = await postJson(`/api/admin/reports/${id}`, { action })
      if (!res.ok) return toast({ title: adminMessages.admin.errorSaving, tone: 'danger' })
      setRows((rs) => rs.filter((r) => r.id !== id))
    },
    [toast],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      const row = rows[cursor]
      if (e.key === 'j') setCursor((c) => Math.min(rows.length - 1, c + 1))
      else if (e.key === 'k') setCursor((c) => Math.max(0, c - 1))
      else if (e.key === 'd' && row) void act(row.id, 'dismiss')
      else if (e.key === 'a' && row) void act(row.id, 'actioned')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, cursor, act])

  return (
    <div className="flex flex-col gap-3">
      <form method="get" action="/admin/reports" className="flex items-center gap-2">
        <select
          name="kind"
          defaultValue={kind}
          className={`${selectClass} w-44`}
          aria-label={m.kind}
        >
          <option value="">{adminMessages.admin.all}</option>
          {Object.entries(m.kinds).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={status}
          className={`${selectClass} w-40`}
          aria-label={adminMessages.admin.series.colState}
        >
          {Object.entries(m.statuses).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 rounded-md border border-line bg-surface-1 px-3 text-[13px] font-semibold hover:bg-surface-2"
        >
          {adminMessages.admin.apply}
        </button>
      </form>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface-1 p-10 text-center text-[13px] text-fg-muted">
          {m.empty}
        </div>
      ) : null}
      <ol className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const href = targetHref(r)
          return (
            <li
              key={r.id}
              className={cn(
                'flex flex-wrap items-start gap-3 rounded-lg border bg-surface-1 p-3',
                i === cursor ? 'border-brand' : 'border-line',
              )}
            >
              <Pill
                tone={r.kind === 'dmca' ? 'danger' : r.kind === 'broken_chapter' ? 'warn' : 'brand'}
              >
                {m.kinds[r.kind as keyof typeof m.kinds] ?? r.kind}
              </Pill>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">{r.reason}</div>
                {r.detail ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-fg-muted">{r.detail}</p>
                ) : null}
                {r.payload && Object.keys(r.payload).length ? (
                  <code className="mt-1 block text-[11px] text-fg-subtle">
                    {JSON.stringify(r.payload)}
                  </code>
                ) : null}
                <div className="mt-1 text-[12px] text-fg-subtle">
                  {m.reporter}: {r.reporter ?? r.reporterEmail ?? m.anonymous} · {r.targetType}
                  {r.targetId ? ` #${r.targetId}` : ''} ·{' '}
                  <time dateTime={r.createdAt}>{relativeTime(new Date(r.createdAt), now)}</time>
                </div>
              </div>
              <div className="flex gap-1.5">
                {href ? (
                  <Button size="sm" variant="outline" href={href}>
                    {m.openTarget}
                  </Button>
                ) : null}
                {status === 'open' ? (
                  <>
                    <Button size="sm" onClick={() => act(r.id, 'actioned')}>
                      {m.markActioned}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => act(r.id, 'dismiss')}>
                      {m.dismiss}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
