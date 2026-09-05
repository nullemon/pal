'use client'

import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, cn, useToast } from '@palscans/ui'
import { useMemo, useState } from 'react'
import { api, postJson } from '@/components/admin/client/api'
import { relativeTime } from '@/components/admin/client/util'
import { inputClass, Pill, selectClass, textareaClass } from '@/components/admin/ui'
import { REQUEST_STATUSES, statusTone } from '@/components/requests/shared'

/**
 * The triage queue. One row per request, expanding to the four things staff do with one:
 * change its status, link the series that fulfils it, merge a duplicate into it, and decline
 * it with a reason the reader sees.
 *
 * The catalogue picker is `/api/search` — the site's own search endpoint, the same
 * `searchSeries` the reader used when they were told the title might already be here. There
 * is no second series search anywhere in this feature.
 */

export interface QueueItem {
  id: number
  title: string
  altTitles: string[]
  link: string | null
  type: string | null
  note: string | null
  status: string
  declineReason: string | null
  voteCount: number
  createdAt: string
  resolvedAt: string | null
  seriesId: number | null
  seriesTitle: string | null
  seriesSlug: string | null
  requester: string | null
  mergedIn: { id: number; title: string }[]
}

const m = messages.requests.admin
const mm = messages.requests

interface SeriesHit {
  id: number
  title: string
  slug: string
}

export function RequestsQueue({
  items,
  status,
  sort,
  q,
}: {
  items: QueueItem[]
  status: string
  sort: string
  q: string
}) {
  const { toast } = useToast()
  const [rows, setRows] = useState(items)
  const [openId, setOpenId] = useState<number | null>(null)
  const [draftStatus, setDraftStatus] = useState<string>('open')
  const [reason, setReason] = useState('')
  const [seriesQuery, setSeriesQuery] = useState('')
  const [hits, setHits] = useState<SeriesHit[]>([])
  const [picked, setPicked] = useState<SeriesHit | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const now = useMemo(() => new Date(), [])

  const expand = (row: QueueItem) => {
    const next = openId === row.id ? null : row.id
    setOpenId(next)
    setDraftStatus(row.status)
    setReason(row.declineReason ?? '')
    setSeriesQuery('')
    setHits([])
    setMergeTarget('')
    setPicked(
      row.seriesId && row.seriesSlug
        ? { id: row.seriesId, title: row.seriesTitle ?? '', slug: row.seriesSlug }
        : null,
    )
  }

  const searchSeries = async (value: string) => {
    setSeriesQuery(value)
    if (value.trim().length < 2) {
      setHits([])
      return
    }
    const res = await api<{ results: SeriesHit[] }>(
      `/api/search?q=${encodeURIComponent(value.trim())}&limit=8`,
    )
    setHits(res.ok ? res.data.results : [])
  }

  const save = async (row: QueueItem) => {
    const needsSeries = draftStatus === 'added' || draftStatus === 'exists'
    if (needsSeries && !picked) {
      toast({ title: m.seriesRequired, tone: 'danger' })
      return
    }
    if (draftStatus === 'declined' && !reason.trim()) {
      toast({ title: m.declineReasonRequired, tone: 'danger' })
      return
    }
    setBusy(true)
    const res = await postJson<{
      request: { status: string; seriesHref: string | null; seriesTitle: string | null }
      notified: boolean
    }>(`/api/admin/requests/${row.id}`, {
      action: 'status',
      status: draftStatus,
      seriesId: needsSeries ? (picked?.id ?? null) : null,
      declineReason: draftStatus === 'declined' ? reason.trim() : undefined,
    })
    setBusy(false)
    if (!res.ok) {
      toast({ title: res.message || adminMessages.admin.errorSaving, tone: 'danger' })
      return
    }
    setRows((rs) =>
      rs.map((r) =>
        r.id === row.id
          ? {
              ...r,
              status: draftStatus,
              declineReason: draftStatus === 'declined' ? reason.trim() : null,
              seriesId: needsSeries ? (picked?.id ?? null) : null,
              seriesTitle: needsSeries ? (picked?.title ?? null) : null,
              seriesSlug: needsSeries ? (picked?.slug ?? null) : null,
            }
          : r,
      ),
    )
    toast({ title: res.data.notified ? m.notified : m.saved })
  }

  const merge = async (row: QueueItem) => {
    const targetId = Number(mergeTarget)
    if (!Number.isInteger(targetId) || targetId <= 0) {
      toast({ title: m.mergeMissing, tone: 'danger' })
      return
    }
    setBusy(true)
    const res = await postJson<{ moved: number }>(`/api/admin/requests/${row.id}`, {
      action: 'merge',
      targetId,
    })
    setBusy(false)
    if (!res.ok) {
      toast({ title: res.message || adminMessages.admin.errorSaving, tone: 'danger' })
      return
    }
    setRows((rs) => rs.filter((r) => r.id !== row.id))
    setOpenId(null)
    toast({ title: fmt(m.merged, { n: res.data.moved }) })
  }

  return (
    <div className="flex flex-col gap-3">
      <form method="get" action="/admin/requests" className="flex flex-wrap items-center gap-2">
        <div className="w-40 shrink-0">
          <select
            name="status"
            defaultValue={status}
            className={selectClass}
            aria-label={mm.filterLabel}
          >
            {(['open', 'planned', 'added', 'exists', 'declined', 'resolved', 'all'] as const).map(
              (k) => (
                <option key={k} value={k}>
                  {mm.statuses[k]}
                </option>
              ),
            )}
          </select>
        </div>
        <div className="w-40 shrink-0">
          <select name="sort" defaultValue={sort} className={selectClass} aria-label={mm.sortVotes}>
            <option value="votes">{mm.sortVotes}</option>
            <option value="new">{mm.sortNew}</option>
          </select>
        </div>
        <div className="w-56 shrink-0">
          <input
            name="q"
            defaultValue={q}
            placeholder={m.searchPlaceholder}
            aria-label={m.searchPlaceholder}
            className={inputClass}
          />
        </div>
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
        {rows.map((row) => {
          const expanded = openId === row.id
          return (
            <li key={row.id} className="rounded-lg border border-line bg-surface-1">
              <div className="flex flex-wrap items-start gap-3 p-3">
                <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] border border-line bg-surface-2">
                  <span className="text-[14px] font-bold tabular-nums leading-none">
                    {row.voteCount}
                  </span>
                  <span className="text-[9px] uppercase tracking-[0.08em] text-fg-subtle">
                    {m.votesColumn}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-semibold">
                      #{row.id} · {row.title}
                    </span>
                    <Pill tone={statusTone(row.status as never)}>
                      {mm.statuses[row.status as keyof typeof mm.statuses] ?? row.status}
                    </Pill>
                    {row.type ? (
                      <span className="text-[11px] uppercase tracking-[0.06em] text-fg-subtle">
                        {row.type}
                      </span>
                    ) : null}
                  </div>
                  {row.altTitles.length > 0 ? (
                    <div className="mt-0.5 text-[12px] text-fg-subtle">
                      {fmt(mm.alsoKnownAs, { titles: row.altTitles.join(' · ') })}
                    </div>
                  ) : null}
                  <div className="mt-1 text-[12px] text-fg-subtle">
                    {row.requester ? `${row.requester} · ` : `${m.byAnonymous} · `}
                    <time dateTime={row.createdAt}>
                      {relativeTime(new Date(row.createdAt), now)}
                    </time>
                    {row.seriesSlug ? ` · ${row.seriesTitle ?? row.seriesSlug}` : ''}
                  </div>
                  {row.mergedIn.length > 0 ? (
                    <div className="mt-1 text-[12px] text-fg-subtle">
                      {fmt(m.mergedInto, {
                        titles: row.mergedIn.map((r) => `#${r.id} ${r.title}`).join(', '),
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-1.5">
                  {row.link ? (
                    // Reader-supplied, so it leaves with no referrer and no ranking signal —
                    // the schema already refuses anything that is not http(s).
                    <Button
                      size="sm"
                      variant="outline"
                      href={row.link}
                      target="_blank"
                      rel="noreferrer nofollow ugc"
                    >
                      {mm.sourceLink}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => expand(row)}>
                    {expanded ? m.collapse : m.open}
                  </Button>
                </div>
              </div>

              {expanded ? (
                <div className="flex flex-col gap-3 border-t border-line-soft p-3">
                  {row.note ? (
                    <p className="whitespace-pre-wrap text-[13px] leading-5 text-fg-muted">
                      {row.note}
                    </p>
                  ) : null}

                  <div className="grid items-start gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`status-${row.id}`}
                        className="text-[12px] font-medium text-fg-muted"
                      >
                        {m.setStatus}
                      </label>
                      <select
                        id={`status-${row.id}`}
                        value={draftStatus}
                        onChange={(e) => setDraftStatus(e.target.value)}
                        className={selectClass}
                      >
                        {REQUEST_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {mm.statuses[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                    {draftStatus === 'added' || draftStatus === 'exists' ? (
                      <div className="flex min-w-0 flex-col gap-1">
                        <label
                          htmlFor={`series-${row.id}`}
                          className="text-[12px] font-medium text-fg-muted"
                        >
                          {m.seriesLabel}
                        </label>
                        {picked ? (
                          <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-line bg-bg px-3 text-[13px]">
                            <span className="truncate">{picked.title}</span>
                            <button
                              type="button"
                              onClick={() => setPicked(null)}
                              className="text-[12px] font-semibold text-fg-muted hover:text-fg"
                            >
                              {messages.nav.close}
                            </button>
                          </div>
                        ) : (
                          <>
                            <input
                              id={`series-${row.id}`}
                              value={seriesQuery}
                              onChange={(e) => void searchSeries(e.target.value)}
                              placeholder={m.seriesPlaceholder}
                              className={inputClass}
                            />
                            {hits.length > 0 ? (
                              <ul className="mt-1 flex flex-col gap-0.5 rounded-md border border-line bg-bg p-1">
                                {hits.map((hit) => (
                                  <li key={hit.id}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPicked(hit)
                                        setHits([])
                                      }}
                                      className="w-full truncate rounded-sm px-2 py-1 text-left text-[13px] hover:bg-surface-2"
                                    >
                                      {hit.title}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {draftStatus === 'declined' ? (
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`reason-${row.id}`}
                        className="text-[12px] font-medium text-fg-muted"
                      >
                        {m.declineReason}
                      </label>
                      <textarea
                        id={`reason-${row.id}`}
                        rows={2}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className={textareaClass}
                      />
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-end gap-2">
                    <Button size="sm" disabled={busy} onClick={() => save(row)}>
                      {m.save}
                    </Button>
                    <div className="ml-auto flex items-end gap-2">
                      <div className="flex w-40 flex-col gap-1">
                        <label
                          htmlFor={`merge-${row.id}`}
                          className="text-[12px] font-medium text-fg-muted"
                        >
                          {m.mergeLabel}
                        </label>
                        <input
                          id={`merge-${row.id}`}
                          value={mergeTarget}
                          inputMode="numeric"
                          placeholder={m.mergePlaceholder}
                          onChange={(e) => setMergeTarget(e.target.value.replace(/\D/g, ''))}
                          className={cn(inputClass, 'tabular-nums')}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !mergeTarget}
                        onClick={() => merge(row)}
                      >
                        {m.merge}
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
