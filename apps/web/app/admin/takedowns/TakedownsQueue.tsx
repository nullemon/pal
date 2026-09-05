'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, cn, useToast } from '@palscans/ui'
import { useMemo, useState } from 'react'
import { postJson } from '@/components/admin/client/api'
import { countdown, formatChapterNumber, relativeTime } from '@/components/admin/client/util'
import { Pill, type PillTone, selectClass, textareaClass } from '@/components/admin/ui'

/**
 * The takedown queue (docs/07). One row per DMCA notice, expandable to the notice itself,
 * its audit trail and the three decisions. The 48-hour SLA from `/dmca` is on every open row
 * as a countdown, because a legal clock nobody can see is a legal clock nobody keeps.
 */

export interface TakedownItem {
  id: number
  claimant: string
  claimantEmail: string
  noticeBody: string
  receivedAt: string
  actionedAt: string | null
  action: string | null
  counterNotice: string | null
  seriesId: number | null
  seriesTitle: string | null
  seriesSlug: string | null
  chapterId: number | null
  chapterNumber: number | null
  actionedBy: string | null
}

export interface TrailEntry {
  takedownId: number
  action: string
  note: string | null
  actor: string | null
  createdAt: string
}

const m = messages.takedowns
const SLA_MS = 48 * 3600 * 1000

const toneFor = (action: string | null, actionedAt: string | null): PillTone => {
  if (actionedAt) return action === 'rejected' ? 'neutral' : 'ok'
  return action === 'acknowledged' ? 'brand' : 'warn'
}

const labelFor = (action: string | null, actionedAt: string | null): string => {
  if (!action) return m.statuses.received
  const known = m.actions[action as keyof typeof m.actions]
  if (known) return known
  return actionedAt ? m.statuses.closed : m.statuses.open
}

function Clock({ receivedAt, now }: { receivedAt: string; now: Date }) {
  const due = new Date(new Date(receivedAt).getTime() + SLA_MS)
  const overdue = due.getTime() <= now.getTime()
  return (
    <span className={cn('text-[12px] font-semibold', overdue ? 'text-danger' : 'text-warn')}>
      {overdue ? m.overdue : fmt(m.dueIn, { time: countdown(due, now) })}
    </span>
  )
}

export function TakedownsQueue({
  status,
  items,
  trail,
}: {
  status: string
  items: TakedownItem[]
  trail: TrailEntry[]
}) {
  const { toast } = useToast()
  const [rows, setRows] = useState(items)
  const [openId, setOpenId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const now = useMemo(() => new Date(), [])
  const trailFor = useMemo(() => {
    const byId = new Map<number, TrailEntry[]>()
    for (const t of trail) byId.set(t.takedownId, [...(byId.get(t.takedownId) ?? []), t])
    return byId
  }, [trail])

  const act = async (id: number, action: 'acknowledge' | 'accept' | 'reject') => {
    if (action !== 'acknowledge' && !note.trim()) {
      toast({ title: m.noteRequired, tone: 'danger' })
      return
    }
    setBusy(true)
    const res = await postJson<{ id: number; action: string; actionedAt: string | null }>(
      `/api/admin/takedowns/${id}`,
      { action, note: note.trim() || undefined },
    )
    setBusy(false)
    if (!res.ok) {
      toast({ title: res.message || messages.admin.errorSaving, tone: 'danger' })
      return
    }
    setRows((rs) =>
      rs.map((r) =>
        r.id === id ? { ...r, action: res.data.action, actionedAt: res.data.actionedAt } : r,
      ),
    )
    setNote('')
    toast({ title: m.saved })
  }

  return (
    <div className="flex flex-col gap-3">
      <form method="get" action="/admin/takedowns" className="flex items-center gap-2">
        {/* `cn` is a plain join, not tailwind-merge, so the width is constrained by a
            wrapper rather than by a second `w-*` the select's own `w-full` would outrank. */}
        <div className="w-44 shrink-0">
          <select
            name="status"
            defaultValue={status}
            className={selectClass}
            aria-label={m.filterStatus}
          >
            {(['open', 'received', 'acknowledged', 'closed', 'all'] as const).map((k) => (
              <option key={k} value={k}>
                {m.statuses[k]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-9 rounded-md border border-line bg-surface-1 px-3 text-[13px] font-semibold hover:bg-surface-2"
        >
          {messages.admin.apply}
        </button>
        <span className="text-[12px] text-fg-subtle">{m.slaHint}</span>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface-1 p-10 text-center text-[13px] text-fg-muted">
          {m.empty}
        </div>
      ) : null}

      <ol className="flex flex-col gap-2">
        {rows.map((r) => {
          const expanded = openId === r.id
          const entries = trailFor.get(r.id) ?? []
          return (
            <li key={r.id} className="rounded-lg border border-line bg-surface-1">
              <div className="flex flex-wrap items-start gap-3 p-3">
                <Pill tone={toneFor(r.action, r.actionedAt)}>
                  {labelFor(r.action, r.actionedAt)}
                </Pill>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold">
                    #{r.id} · {r.claimant}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-fg-muted">{r.claimantEmail}</div>
                  <div className="mt-1 text-[12px] text-fg-subtle">
                    {r.seriesTitle ? (
                      <>
                        {r.seriesTitle}
                        {r.chapterNumber !== null
                          ? ` · ${fmt(m.chapterTarget, {
                              n: formatChapterNumber(r.chapterNumber),
                            })}`
                          : ''}
                      </>
                    ) : (
                      m.noTarget
                    )}{' '}
                    ·{' '}
                    <time dateTime={r.receivedAt}>{relativeTime(new Date(r.receivedAt), now)}</time>{' '}
                    {r.actionedAt ? null : <Clock receivedAt={r.receivedAt} now={now} />}
                  </div>
                  {r.actionedAt ? (
                    <div className="mt-1 text-[12px] text-fg-subtle">
                      {fmt(m.actionedBy, {
                        name: r.actionedBy ?? '—',
                        time: relativeTime(new Date(r.actionedAt), now),
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-1.5">
                  {r.seriesSlug ? (
                    <Button size="sm" variant="outline" href={`/admin/series/${r.seriesId}`}>
                      {messages.admin.reportsQueue.openTarget}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setOpenId(expanded ? null : r.id)
                      setNote('')
                    }}
                  >
                    {expanded ? m.close : m.open}
                  </Button>
                </div>
              </div>

              {expanded ? (
                <div className="flex flex-col gap-3 border-t border-line-soft p-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
                      {m.notice}
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap break-words font-body text-[13px] leading-5 text-fg-muted">
                      {r.noticeBody}
                    </pre>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
                      {m.trail}
                    </div>
                    {entries.length === 0 ? (
                      <p className="mt-1 text-[13px] text-fg-subtle">{m.trailEmpty}</p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-1">
                        {entries.map((t) => (
                          <li key={`${t.createdAt}-${t.action}`} className="text-[13px]">
                            <span className="font-semibold">{t.action}</span>{' '}
                            <span className="text-fg-subtle">
                              · {t.actor ?? '—'} ·{' '}
                              <time dateTime={t.createdAt}>
                                {relativeTime(new Date(t.createdAt), now)}
                              </time>
                            </span>
                            {t.note ? (
                              <p className="text-fg-muted whitespace-pre-wrap">{t.note}</p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor={`note-${r.id}`}
                      className="text-[12px] font-medium leading-4 text-fg-muted"
                    >
                      {m.noteLabel}
                    </label>
                    <textarea
                      id={`note-${r.id}`}
                      rows={3}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={m.notePlaceholder}
                      className={textareaClass}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => act(r.id, 'acknowledge')}
                      >
                        {m.acknowledge}
                      </Button>
                      <Button size="sm" disabled={busy} onClick={() => act(r.id, 'accept')}>
                        {m.accept}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => act(r.id, 'reject')}
                      >
                        {m.reject}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
