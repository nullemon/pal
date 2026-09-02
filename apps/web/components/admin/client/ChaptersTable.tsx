'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, cn, useToast } from '@palscans/ui'
import { RefreshCw } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { BulkAction } from '../schemas'
import { ChapterStatePill, EmptyRow, inputClass, Num, Table, Td, Th } from '../ui'
import { postJson } from './api'
import { Modal } from './controls'
import type { EditorPerms } from './SeriesEditor'
import { countdown, formatChapterNumber } from './util'

export interface ChapterRowData {
  id: number
  number: number
  title: string | null
  volume: number | null
  state: string
  isPremium: boolean
  earlyAccessUntil: string | null
  publishedAt: string | null
  pageCount: number
  viewCount: number
  deletedAt: string | null
  errors: number
  done: number
  total: number
}

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const describe = (iso: string | null, now: Date) => {
  if (!iso) return messages.admin.chapters.bulk.now
  const d = new Date(iso)
  if (d.getTime() <= now.getTime()) return messages.admin.chapters.bulk.now
  return `${d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} (in ${countdown(d, now)})`
}

/**
 * The embedded chapter table (docs/04 "Chapter management"): shift-range multi-select and a
 * bulk bar — Publish now · Schedule… · Set premium · Clear premium · Set early access window ·
 * Delete — plus per-row retry for failed pipeline runs.
 */
export function ChaptersTable({
  seriesId,
  initial,
  perms,
}: {
  seriesId: number
  initial: ChapterRowData[]
  perms: EditorPerms
}) {
  const m = messages.admin.chapters
  const { toast } = useToast()
  const [rows, setRows] = useState(initial)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<'schedule' | 'early' | null>(null)
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 86_400_000)))
  const lastClick = useRef<number | null>(null)
  const visible = useMemo(() => rows.filter((r) => !r.deletedAt), [rows])
  const now = new Date()

  const toggle = (id: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (shift && lastClick.current !== null) {
        const ids = visible.map((r) => r.id)
        const a = ids.indexOf(lastClick.current)
        const b = ids.indexOf(id)
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
            const x = ids[i]
            if (x !== undefined) next.add(x)
          }
          return next
        }
      }
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    lastClick.current = id
  }

  const run = useCallback(
    async (action: BulkAction, optimistic?: (r: ChapterRowData) => ChapterRowData) => {
      setBusy(true)
      const before = rows
      if (optimistic)
        setRows((rs) => rs.map((r) => (action.ids.includes(r.id) ? optimistic(r) : r)))
      const res = await postJson<{ affected: number[] }>('/api/admin/chapters/bulk', action)
      setBusy(false)
      if (!res.ok) {
        setRows(before)
        toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
        return false
      }
      const n = res.data.affected.length
      if (action.action === 'delete') {
        toast({
          title: fmt(m.bulk.deleted, { n }),
          tone: 'danger',
          action: {
            label: messages.common.undo,
            onClick: () => {
              void postJson('/api/admin/chapters/bulk', {
                action: 'restore',
                ids: action.ids,
              }).then(() =>
                setRows((rs) =>
                  rs.map((r) => (action.ids.includes(r.id) ? { ...r, deletedAt: null } : r)),
                ),
              )
            },
          },
        })
      } else toast({ title: fmt(m.bulk.updated, { n }), tone: 'ok' })
      setSelected(new Set())
      return true
    },
    [rows, toast, m.bulk.deleted, m.bulk.updated],
  )

  const ids = [...selected]
  const publishNow = () =>
    run({ action: 'publish_now', ids }, (r) =>
      r.pageCount > 0
        ? { ...r, state: 'published', publishedAt: r.publishedAt ?? now.toISOString() }
        : r,
    )
  const retry = async (id: number, failedOnly: boolean) => {
    const res = await postJson<{ jobId: string | null }>(`/api/admin/chapters/${id}/retry`, {
      failedOnly,
    })
    if (!res.ok)
      return toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, state: 'processing' } : r)))
    toast({ title: messages.admin.upload.committed, tone: 'ok' })
  }

  const whenIso = () => new Date(when).toISOString()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {perms.create ? (
          <Button href={`/admin/upload?series=${seriesId}`} size="sm">
            {m.uploadChapters}
          </Button>
        ) : null}
        <span className="text-[13px] text-fg-muted">{visible.length} · </span>
        <span className="text-[12px] text-fg-subtle">shift+click selects a range</span>
      </div>
      {selected.size > 0 ? (
        <div className="sticky top-[60px] z-20 flex flex-wrap items-center gap-2 rounded-lg border border-brand/40 bg-surface-2 px-3 py-2 shadow-2">
          <span className="text-[13px] font-semibold">
            {fmt(messages.admin.selected, { n: selected.size })}
          </span>
          <button
            type="button"
            className="text-[12px] text-fg-muted underline"
            onClick={() => setSelected(new Set())}
          >
            {messages.admin.clearSelection}
          </button>
          <span className="mx-1 h-5 w-px bg-line" />
          {perms.publish ? (
            <>
              <Button size="sm" disabled={busy} onClick={publishNow}>
                {m.bulk.publishNow}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setModal('schedule')}
              >
                {m.bulk.schedule}
              </Button>
            </>
          ) : null}
          {perms.chapterUpdate ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run({ action: 'set_premium', ids }, (r) => ({ ...r, isPremium: true }))
                }
              >
                {m.bulk.setPremium}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run({ action: 'clear_premium', ids }, (r) => ({ ...r, isPremium: false }))
                }
              >
                {m.bulk.clearPremium}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setModal('early')}>
                {m.bulk.earlyAccess}
              </Button>
            </>
          ) : null}
          {perms.chapterDelete ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto text-danger"
              disabled={busy}
              onClick={() =>
                run({ action: 'delete', ids }, (r) => ({ ...r, deletedAt: now.toISOString() }))
              }
            >
              {m.bulk.delete}
            </Button>
          ) : null}
        </div>
      ) : null}
      <Table>
        <thead>
          <tr>
            <Th className="w-8">
              <input
                type="checkbox"
                aria-label={messages.admin.all}
                checked={visible.length > 0 && selected.size === visible.length}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(visible.map((r) => r.id)) : new Set())
                }
              />
            </Th>
            <Th>{m.colChapter}</Th>
            <Th>{m.colState}</Th>
            <Th align="right">{m.colPages}</Th>
            <Th>{m.colPremium}</Th>
            <Th>{m.colPublished}</Th>
            <Th align="right">{m.colViews}</Th>
            <Th align="right">{messages.admin.actions}</Th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? <EmptyRow colSpan={8}>{m.noChapters}</EmptyRow> : null}
          {visible.map((r) => {
            const early =
              r.earlyAccessUntil && new Date(r.earlyAccessUntil).getTime() > now.getTime()
            return (
              <tr
                key={r.id}
                className={cn('hover:bg-surface-2/60', selected.has(r.id) && 'bg-brand-wash/40')}
              >
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`Ch. ${formatChapterNumber(r.number)}`}
                    checked={selected.has(r.id)}
                    onClick={(e) => toggle(r.id, e.shiftKey)}
                    onChange={() => undefined}
                  />
                </Td>
                <Td>
                  <span className="font-semibold">Ch. {formatChapterNumber(r.number)}</span>
                  {r.title ? <span className="ml-2 text-fg-muted">{r.title}</span> : null}
                </Td>
                <Td>
                  <ChapterStatePill state={r.state} />
                  {r.state === 'processing' ? (
                    <Num className="ml-2 text-[12px] text-fg-muted">
                      {r.done}/{r.total}
                    </Num>
                  ) : null}
                  {r.errors > 0 ? (
                    <span className="ml-2 text-[12px] text-danger">
                      {fmt(m.pageErrors, { n: r.errors })}
                    </span>
                  ) : null}
                </Td>
                <Td align="right">
                  <Num>{r.pageCount}</Num>
                </Td>
                <Td>
                  {r.isPremium ? (
                    <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-gold">
                      Premium
                    </span>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                  {early ? (
                    <span className="ml-2 text-[11px] text-fg-muted">
                      early → {countdown(new Date(r.earlyAccessUntil ?? 0), now)}
                    </span>
                  ) : null}
                </Td>
                <Td className="text-fg-muted">
                  {r.publishedAt ? (
                    <time dateTime={r.publishedAt} className="tabular-nums">
                      {r.state === 'scheduled'
                        ? `in ${countdown(new Date(r.publishedAt), now)} · `
                        : ''}
                      {r.publishedAt.slice(0, 16).replace('T', ' ')}
                    </time>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td align="right">
                  <Num>{r.viewCount}</Num>
                </Td>
                <Td align="right">
                  <div className="flex justify-end gap-1">
                    {r.state === 'failed' && perms.repair ? (
                      <>
                        <button
                          type="button"
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-semibold hover:bg-surface-2"
                          onClick={() => retry(r.id, true)}
                        >
                          <RefreshCw size={12} aria-hidden="true" />
                          {m.retryFailed}
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-7 items-center rounded-md px-2 text-[12px] text-fg-muted hover:bg-surface-2"
                          onClick={() => retry(r.id, false)}
                        >
                          {m.reprocess}
                        </button>
                      </>
                    ) : null}
                    <a
                      href={`/admin/chapters?series=${seriesId}&chapter=${r.id}`}
                      className="inline-flex h-7 items-center rounded-md px-2 text-[12px] text-fg-muted hover:bg-surface-2"
                    >
                      {messages.admin.open}
                    </a>
                  </div>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      <Modal
        open={modal === 'schedule'}
        title={fmt(m.bulk.scheduleTitle, { n: selected.size })}
        onClose={() => setModal(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setModal(null)}>
              {messages.common.cancel}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                const iso = whenIso()
                if (
                  await run({ action: 'schedule', ids, publishedAt: iso }, (r) =>
                    r.pageCount > 0
                      ? {
                          ...r,
                          state: new Date(iso) <= now ? 'published' : 'scheduled',
                          publishedAt: iso,
                        }
                      : r,
                  )
                )
                  setModal(null)
              }}
            >
              {m.bulk.schedule.replace('…', '')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-fg-muted">{m.bulk.scheduleHint}</p>
        <input
          type="datetime-local"
          className={inputClass}
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <p className="text-[13px]">{describe(when ? new Date(when).toISOString() : null, now)}</p>
      </Modal>

      <Modal
        open={modal === 'early'}
        title={fmt(m.bulk.earlyAccessTitle, { n: selected.size })}
        onClose={() => setModal(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setModal(null)}>
              {messages.common.cancel}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () =>
                (await run({ action: 'early_access', ids, earlyAccessUntil: null }, (r) => ({
                  ...r,
                  earlyAccessUntil: null,
                }))) && setModal(null)
              }
            >
              {m.bulk.clearEarlyAccess}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                const iso = whenIso()
                if (
                  await run({ action: 'early_access', ids, earlyAccessUntil: iso }, (r) => ({
                    ...r,
                    earlyAccessUntil: iso,
                  }))
                )
                  setModal(null)
              }}
            >
              {messages.admin.apply}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-fg-muted">{m.bulk.earlyAccessHint}</p>
        <input
          type="datetime-local"
          className={inputClass}
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <p className="text-[13px]">
          {fmt(m.bulk.timeline, {
            premium: m.bulk.now,
            everyone: describe(when ? new Date(when).toISOString() : null, now),
          })}
        </p>
      </Modal>
    </div>
  )
}
