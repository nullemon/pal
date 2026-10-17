'use client'

import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import type { WatermarkPageState } from '@palscans/core/watermark'
import { Button, cn, useToast } from '@palscans/ui'
import { Images, Pencil, RefreshCw, Stamp, Users } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { BulkAction } from '../schemas'
import {
  ChapterStatePill,
  EmptyRow,
  inputClass,
  Num,
  Pill,
  type PillTone,
  selectClass,
  Table,
  Td,
  Th,
} from '../ui'
import { api, patchJson, postJson } from './api'
import { Modal } from './controls'
import type { EditorPerms } from './SeriesEditor'
import { canEditPages, countdown, formatChapterNumber } from './util'

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
  /** Which watermark this chapter's stored pages carry, against the one configured now. */
  watermark: WatermarkPageState
}

/**
 * Which mark a chapter's pages carry.
 *
 * The label says it; the tone only reinforces it. `unmarkable` is deliberately the loudest:
 * it is the one state no re-apply can ever fix, because the uploaded originals are gone.
 */
const MARK_TONE: Record<WatermarkPageState, PillTone> = {
  current: 'ok',
  stale: 'warn',
  unknown: 'neutral',
  // Not a fault: there is simply nothing of ours to mark.
  remote: 'brand',
  unmarkable: 'danger',
  unprocessed: 'neutral',
}

export function WatermarkPill({ state }: { state: WatermarkPageState }) {
  const m = adminMessages.admin.chapters
  return (
    <span title={m.markHints[state]}>
      <Pill tone={MARK_TONE[state]}>{m.mark[state]}</Pill>
    </span>
  )
}

/** One row of the groups catalogue, as the picker needs it. */
interface GroupOption {
  id: number
  name: string
}

const pagesHref = (r: ChapterRowData) => `/admin/chapters/${r.id}/pages`

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const describe = (iso: string | null, now: Date) => {
  if (!iso) return adminMessages.admin.chapters.bulk.now
  const d = new Date(iso)
  if (d.getTime() <= now.getTime()) return adminMessages.admin.chapters.bulk.now
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
  const m = adminMessages.admin.chapters
  const g = adminMessages.groupsAdmin
  const { toast } = useToast()
  const [rows, setRows] = useState(initial)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<'schedule' | 'early' | 'groups' | null>(null)
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 86_400_000)))
  /**
   * The group picker's options, fetched the first time it is opened rather than with the
   * page: most visits to a series are not about credits, and the list is the same for every
   * series, so paying for it up front would be a request per page load for nothing.
   */
  const [groupOptions, setGroupOptions] = useState<GroupOption[] | null>(null)
  const [groupId, setGroupId] = useState('')
  /**
   * The chapter being renamed or renumbered.
   *
   * Both have been editable through `PATCH /api/admin/chapters/:id` since it was written and
   * neither had a control anywhere in the panel, so a typo'd number or title meant deleting
   * the chapter and uploading it again. This is that control.
   */
  const [editing, setEditing] = useState<ChapterRowData | null>(null)
  const [draftNumber, setDraftNumber] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftVolume, setDraftVolume] = useState('')
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
      const res = await postJson<{ affected: number[]; runId: string | null }>(
        '/api/admin/chapters/bulk',
        action,
      )
      setBusy(false)
      if (!res.ok) {
        setRows(before)
        toast({
          title:
            res.status === 409 && action.action === 'reapply_watermark'
              ? m.reapplyBusy
              : adminMessages.admin.errorSaving,
          description: res.status === 409 ? undefined : res.message,
          tone: 'danger',
        })
        return false
      }
      const n = res.data.affected.length
      if (action.action === 'reapply_watermark') {
        toast({ title: fmt(m.reapplyQueued, { n }), tone: 'ok' })
        setSelected(new Set())
        return true
      }
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
    [rows, toast, m.bulk.deleted, m.bulk.updated, m.reapplyBusy, m.reapplyQueued],
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
      return toast({
        title: adminMessages.admin.errorSaving,
        description: res.message,
        tone: 'danger',
      })
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, state: 'processing' } : r)))
    toast({ title: adminMessages.admin.upload.committed, tone: 'ok' })
  }

  const openEdit = (row: ChapterRowData) => {
    setEditing(row)
    setDraftNumber(formatChapterNumber(row.number))
    setDraftTitle(row.title ?? '')
    setDraftVolume(row.volume === null ? '' : String(row.volume))
  }

  /**
   * The number this edit would take, and whether another chapter already holds it.
   *
   * Checked here as well as by the database so the operator is told while the dialog is
   * open, next to the field they typed into, rather than by a failed save. The index is
   * still the authority — two people renumbering at once is its to settle — and the route
   * answers 409 for that.
   */
  const editNumber = Number.parseFloat(draftNumber)
  const numberTaken =
    editing !== null &&
    Number.isFinite(editNumber) &&
    rows.some(
      (r) => r.id !== editing.id && !r.deletedAt && r.number.toFixed(3) === editNumber.toFixed(3),
    )

  const saveEdit = useCallback(async () => {
    if (!editing) return
    const number = Number.parseFloat(draftNumber)
    if (!Number.isFinite(number)) return
    const volume = draftVolume.trim() === '' ? null : Number.parseInt(draftVolume, 10)
    const title = draftTitle.trim() === '' ? null : draftTitle.trim()
    setBusy(true)
    const res = await patchJson(`/api/admin/chapters/${editing.id}`, {
      number,
      title,
      volume: Number.isFinite(volume as number) ? volume : null,
    })
    setBusy(false)
    if (!res.ok) {
      toast({
        title: res.status === 409 ? m.edit.taken : adminMessages.admin.errorSaving,
        description: res.status === 409 ? undefined : res.message,
        tone: 'danger',
      })
      return
    }
    setRows((rs) =>
      rs.map((r) =>
        r.id === editing.id
          ? { ...r, number, title, volume: Number.isFinite(volume as number) ? volume : null }
          : r,
      ),
    )
    setEditing(null)
    toast({ title: m.edit.saved, tone: 'ok' })
  }, [editing, draftNumber, draftTitle, draftVolume, toast, m.edit.saved, m.edit.taken])

  const whenIso = () => new Date(when).toISOString()

  const openGroups = useCallback(async () => {
    setModal('groups')
    if (groupOptions) return
    const res = await api<{ groups: GroupOption[] }>('/api/admin/groups')
    // An empty list is a real answer — no groups have been added yet — and the modal says so,
    // which is more useful than an endless spinner.
    setGroupOptions(res.ok ? res.data.groups : [])
  }, [groupOptions])

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
            {fmt(adminMessages.admin.selected, { n: selected.size })}
          </span>
          <button
            type="button"
            className="text-[12px] text-fg-muted underline"
            onClick={() => setSelected(new Set())}
          >
            {adminMessages.admin.clearSelection}
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
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void openGroups()}>
                <Users size={13} aria-hidden="true" />
                {g.assign}
              </Button>
            </>
          ) : null}
          {perms.repair ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run({ action: 'reapply_watermark', ids })}
            >
              <Stamp size={13} aria-hidden="true" />
              {m.reapplyWatermark}
            </Button>
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
                aria-label={adminMessages.admin.all}
                checked={visible.length > 0 && selected.size === visible.length}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(visible.map((r) => r.id)) : new Set())
                }
              />
            </Th>
            <Th>{m.colChapter}</Th>
            <Th>{m.colState}</Th>
            <Th>{m.colMark}</Th>
            <Th align="right">{m.colPages}</Th>
            <Th>{m.colPremium}</Th>
            <Th>{m.colPublished}</Th>
            <Th align="right">{m.colViews}</Th>
            <Th align="right">{adminMessages.admin.actions}</Th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? <EmptyRow colSpan={9}>{m.noChapters}</EmptyRow> : null}
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
                <Td>
                  <WatermarkPill state={r.watermark} />
                </Td>
                <Td align="right">
                  {/*
                   * The count is the way in to the page editor, as it is on Admin → Chapters:
                   * the number is what an operator is looking at when they notice it is wrong.
                   * There is an explicit button in Actions too, because a bare number does not
                   * read as a link — which is how a whole editing screen stayed invisible from
                   * the screen people actually manage a series from.
                   */}
                  {canEditPages(r) ? (
                    <a
                      className="hover:text-brand-hover"
                      href={pagesHref(r)}
                      title={m.editPagesHint}
                    >
                      <Num>{r.pageCount}</Num>
                    </a>
                  ) : (
                    <Num>{r.pageCount}</Num>
                  )}
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
                    {perms.repair && r.watermark !== 'current' && r.watermark !== 'unprocessed' ? (
                      <button
                        type="button"
                        title={m.markHints[r.watermark]}
                        disabled={busy || r.watermark === 'unmarkable'}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-semibold hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => void run({ action: 'reapply_watermark', ids: [r.id] })}
                      >
                        <Stamp size={12} aria-hidden="true" />
                        {m.reapplyWatermark}
                      </button>
                    ) : null}
                    {perms.chapterUpdate ? (
                      <button
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-semibold hover:bg-surface-2"
                        onClick={() => openEdit(r)}
                        title={m.edit.hint}
                        type="button"
                      >
                        <Pencil size={12} aria-hidden="true" />
                        {m.edit.action}
                      </button>
                    ) : null}
                    {canEditPages(r) ? (
                      <a
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-semibold hover:bg-surface-2"
                        href={pagesHref(r)}
                        title={m.editPagesHint}
                      >
                        <Images size={12} aria-hidden="true" />
                        {m.editPages}
                      </a>
                    ) : null}
                    <a
                      href={`/admin/chapters?series=${seriesId}&chapter=${r.id}`}
                      className="inline-flex h-7 items-center rounded-md px-2 text-[12px] text-fg-muted hover:bg-surface-2"
                    >
                      {adminMessages.admin.open}
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
              {adminMessages.admin.apply}
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

      {/*
       * Rename and renumber. Small dialog, but it is the difference between fixing a typo and
       * deleting a chapter to upload it again, which is what the panel offered before.
       */}
      <Modal
        open={editing !== null}
        title={m.edit.title}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              {messages.common.cancel}
            </Button>
            <Button
              size="sm"
              disabled={busy || numberTaken || !Number.isFinite(editNumber)}
              onClick={() => void saveEdit()}
            >
              {m.edit.save}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            {m.edit.number}
            <input
              className={inputClass}
              inputMode="decimal"
              onChange={(e) => setDraftNumber(e.target.value)}
              value={draftNumber}
            />
          </label>
          {/* Decimals are not a workaround here, they are how a .5 release is numbered. */}
          <p className="text-[12px] text-fg-muted">{m.edit.numberHint}</p>
          {numberTaken ? <p className="text-[12.5px] text-danger">{m.edit.taken}</p> : null}
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            {m.edit.chapterTitle}
            <input
              className={inputClass}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder={m.edit.untitled}
              value={draftTitle}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            {m.edit.volume}
            <input
              className={inputClass}
              inputMode="numeric"
              onChange={(e) => setDraftVolume(e.target.value)}
              placeholder={m.edit.noVolume}
              value={draftVolume}
            />
          </label>
        </div>
      </Modal>

      {/*
       * Crediting the selection, for a title that changed hands mid-run — the whole-series
       * shortcut is the panel above the table. "No credit" is a real choice here and not a
       * placeholder: it is the only way to take a wrong credit back off.
       */}
      <Modal
        open={modal === 'groups'}
        title={fmt(g.assignTitle, { n: selected.size })}
        onClose={() => setModal(null)}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setModal(null)}>
              {messages.common.cancel}
            </Button>
            <Button
              size="sm"
              disabled={busy || groupOptions === null}
              onClick={async () =>
                (await run({
                  action: 'set_groups',
                  ids,
                  groupIds: groupId === '' ? [] : [Number(groupId)],
                })) && setModal(null)
              }
            >
              {adminMessages.admin.apply}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-fg-muted">{g.assignPick}</p>
        <select
          className={selectClass}
          onChange={(e) => setGroupId(e.target.value)}
          value={groupId}
        >
          <option value="">{g.none}</option>
          {(groupOptions ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {groupOptions?.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted">{g.noGroupsYet}</p>
        ) : null}
      </Modal>
    </div>
  )
}
