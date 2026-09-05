'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, cn, useToast } from '@palscans/ui'
import { CalendarClock, ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildGrid,
  type CalendarView,
  dayKey,
  fromLocalInput,
  parseAnchor,
  rangeLabel,
  shiftAnchor,
  startOfDay,
  toLocalInput,
  withTimeOf,
} from '@/app/admin/chapters/calendar/grid'
import type { CalendarChapter } from '../server/calendar'
import { inputClass, Panel, Pill } from '../ui'
import { patchJson, postJson } from './api'
import { Modal, Segmented } from './controls'
import { formatChapterNumber } from './util'

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/** Cards drawn in a month cell before the rest become a count (a week row must not stretch). */
const MONTH_CARDS = 3

/** A chapter that has not gone out yet can still be moved; history cannot. */
const isMovable = (c: CalendarChapter) => c.state !== 'published'

export function ReleaseCalendar({
  view,
  anchor,
  data,
  canPublish,
}: {
  view: CalendarView
  anchor: string
  data: { dated: CalendarChapter[]; backlog: CalendarChapter[]; backlogTotal: number }
  canPublish: boolean
}) {
  const m = adminMessages.calendar
  const { toast } = useToast()
  const router = useRouter()
  const [rows, setRows] = useState<CalendarChapter[]>([...data.dated, ...data.backlog])
  const [editing, setEditing] = useState<CalendarChapter | null>(null)
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState<string | null>(null)
  const dragged = useRef<number | null>(null)

  useEffect(() => {
    setRows([...data.dated, ...data.backlog])
  }, [data])

  const grid = useMemo(() => buildGrid(view, parseAnchor(anchor)), [view, anchor])
  const today = startOfDay(new Date())
  const todayKey = dayKey(today)

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarChapter[]>()
    for (const row of rows) {
      if (!row.publishedAt) continue
      const key = dayKey(new Date(row.publishedAt))
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    for (const list of map.values())
      list.sort((a, b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''))
    return map
  }, [rows])

  const backlog = useMemo(() => rows.filter((r) => !r.publishedAt), [rows])
  const counts = useMemo(() => {
    let published = 0
    let scheduled = 0
    for (const [key, list] of byDay)
      if (grid.days.some((d) => dayKey(d) === key))
        for (const row of list) {
          if (row.state === 'published') published += 1
          else scheduled += 1
        }
    return { published, scheduled }
  }, [byDay, grid.days])

  const href = (next: { view?: CalendarView; date?: Date }) => {
    const params = new URLSearchParams()
    params.set('view', next.view ?? view)
    params.set('date', dayKey(next.date ?? parseAnchor(anchor)))
    return `/admin/chapters/calendar?${params.toString()}`
  }

  /** Every move goes through the shared transitions — never a bespoke UPDATE. */
  const apply = async (
    chapter: CalendarChapter,
    action: 'schedule' | 'publish_now' | 'unschedule',
    at?: Date,
  ) => {
    setBusy(true)
    const before = rows
    const optimistic = (patch: Partial<CalendarChapter>) =>
      setRows((rs) => rs.map((r) => (r.id === chapter.id ? { ...r, ...patch } : r)))
    let okResult = false
    if (action === 'schedule' && at) {
      const future = at.getTime() > Date.now()
      optimistic({
        publishedAt: at.toISOString(),
        state: future ? 'scheduled' : 'published',
      })
      const res = await postJson<{ affected: number[] }>('/api/admin/chapters/bulk', {
        action: 'schedule',
        ids: [chapter.id],
        publishedAt: at.toISOString(),
      })
      okResult = res.ok && res.data.affected.length > 0
      if (okResult)
        toast({
          title: fmt(m.moved, {
            n: formatChapterNumber(chapter.number),
            when: at.toLocaleString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }),
          }),
          tone: 'ok',
        })
    } else if (action === 'publish_now') {
      optimistic({ publishedAt: new Date().toISOString(), state: 'published' })
      const res = await postJson<{ affected: number[] }>('/api/admin/chapters/bulk', {
        action: 'publish_now',
        ids: [chapter.id],
      })
      okResult = res.ok && res.data.affected.length > 0
      if (okResult)
        toast({
          title: fmt(m.publishedNow, { n: formatChapterNumber(chapter.number) }),
          tone: 'ok',
        })
    } else {
      optimistic({ publishedAt: null, state: 'ready' })
      const res = await patchJson<unknown>(`/api/admin/chapters/${chapter.id}`, {
        state: 'ready',
        publishedAt: null,
      })
      okResult = res.ok
      if (okResult)
        toast({
          title: fmt(m.unscheduled, { n: formatChapterNumber(chapter.number) }),
          tone: 'ok',
        })
    }
    setBusy(false)
    if (!okResult) {
      setRows(before)
      toast({ title: m.moveFailed, tone: 'danger' })
      return false
    }
    router.refresh()
    return true
  }

  const onDropDay = async (day: Date) => {
    setOver(null)
    const id = dragged.current
    dragged.current = null
    const chapter = rows.find((r) => r.id === id)
    if (!chapter || !isMovable(chapter)) return
    const target = withTimeOf(day, chapter.publishedAt ? new Date(chapter.publishedAt) : null)
    if (startOfDay(day).getTime() < today.getTime()) {
      toast({ title: m.pastDay, tone: 'neutral' })
      return
    }
    await apply(chapter, 'schedule', target)
  }

  const card = (chapter: CalendarChapter, compact: boolean) => {
    const movable = isMovable(chapter)
    const time = chapter.publishedAt
      ? new Date(chapter.publishedAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null
    return (
      <li
        key={chapter.id}
        data-chapter={chapter.id}
        draggable={movable && !busy}
        onDragStart={(e) => {
          dragged.current = chapter.id
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => {
          dragged.current = null
          setOver(null)
        }}
        className={cn(
          'group relative rounded-md border px-1.5 py-1 text-[11.5px] leading-[15px]',
          chapter.state === 'published'
            ? 'border-ok/30 bg-ok/10'
            : chapter.publishedAt
              ? 'border-gold/40 bg-gold/10'
              : 'border-warn/40 bg-warn/10',
          movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        )}
      >
        <div className="flex items-center gap-1">
          {movable ? (
            <GripVertical size={10} className="shrink-0 text-fg-subtle" aria-hidden="true" />
          ) : null}
          <span className="font-semibold tabular-nums">
            {time ? <span className="mr-1 text-fg-muted">{time}</span> : null}
            Ch. {formatChapterNumber(chapter.number)}
          </span>
          {chapter.isPremium ? (
            <span className="ml-auto text-[9px] font-bold uppercase tracking-[0.06em] text-gold">
              ★
            </span>
          ) : null}
        </div>
        <div className={cn('truncate text-fg-muted', compact ? '' : 'text-[11px]')}>
          {chapter.seriesTitle}
        </div>
        <button
          type="button"
          className="absolute top-0.5 right-0.5 rounded-sm bg-surface-3/95 px-1 text-[10px] font-semibold text-fg opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100"
          onClick={() => {
            setEditing(chapter)
            setWhen(
              toLocalInput(
                chapter.publishedAt ? new Date(chapter.publishedAt) : withTimeOf(new Date(), null),
              ),
            )
          }}
        >
          {m.edit}
        </button>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<CalendarView>
          size="sm"
          ariaLabel={m.title}
          value={view}
          onChange={(v) => router.push(href({ view: v }))}
          options={[
            { value: 'week', label: m.week },
            { value: 'month', label: m.month },
          ]}
        />
        <div className="flex items-center gap-1">
          <a
            href={href({ date: shiftAnchor(view, parseAnchor(anchor), -1) })}
            aria-label={m.previous}
            className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface-1 hover:bg-surface-2"
          >
            <ChevronLeft size={16} />
          </a>
          <a
            href={href({ date: shiftAnchor(view, parseAnchor(anchor), 1) })}
            aria-label={m.next}
            className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface-1 hover:bg-surface-2"
          >
            <ChevronRight size={16} />
          </a>
          <a
            href={href({ date: new Date() })}
            className="inline-flex h-9 items-center rounded-md border border-line bg-surface-1 px-3 text-[13px] font-semibold hover:bg-surface-2"
          >
            {m.today}
          </a>
        </div>
        <h2 className="font-body text-[16px] font-bold normal-case tracking-normal">
          {rangeLabel(grid)}
        </h2>
        <span className="ml-auto text-[12.5px] text-fg-muted">
          {fmt(m.legend, {
            published: counts.published,
            scheduled: counts.scheduled,
            ready: data.backlogTotal,
          })}
        </span>
      </div>

      <div className="grid gap-3.5 xl:grid-cols-[1fr_260px]">
        <Panel className="overflow-x-auto p-2 md:p-3">
          <div className="grid min-w-[720px] grid-cols-7 gap-1.5">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="px-1 pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-fg-subtle"
              >
                {m.weekdays[d]}
              </div>
            ))}
            {grid.days.map((day) => {
              const key = dayKey(day)
              const list = byDay.get(key) ?? []
              const outside = view === 'month' && day.getMonth() !== grid.anchor.getMonth()
              const past = startOfDay(day).getTime() < today.getTime()
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: drop target; the Edit button on each card is the keyboard path
                <div
                  key={key}
                  data-day={key}
                  onDragOver={(e) => {
                    if (dragged.current === null) return
                    e.preventDefault()
                    setOver(key)
                  }}
                  onDragLeave={() => setOver((o) => (o === key ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault()
                    void onDropDay(day)
                  }}
                  className={cn(
                    'flex min-h-[104px] flex-col gap-1 rounded-md border p-1.5 transition-colors',
                    outside ? 'bg-bg/40 opacity-60' : 'bg-bg',
                    over === key
                      ? 'border-brand bg-brand-wash'
                      : key === todayKey
                        ? 'border-brand/50'
                        : 'border-line',
                    past && over !== key ? 'opacity-80' : '',
                  )}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        'text-[12px] font-bold tabular-nums',
                        key === todayKey ? 'text-brand-hover' : 'text-fg-muted',
                      )}
                    >
                      {day.getDate()}
                    </span>
                    {view === 'month' && day.getDate() === 1 ? (
                      <span className="text-[10px] uppercase tracking-[0.06em] text-fg-subtle">
                        {day.toLocaleDateString(undefined, { month: 'short' })}
                      </span>
                    ) : null}
                    {list.length > 2 ? (
                      <span className="ml-auto text-[10px] tabular-nums text-fg-subtle">
                        {list.length}
                      </span>
                    ) : null}
                  </div>
                  <ul className="flex flex-col gap-1">
                    {(view === 'month' ? list.slice(0, MONTH_CARDS) : list).map((c) =>
                      card(c, true),
                    )}
                  </ul>
                  {view === 'month' && list.length > MONTH_CARDS ? (
                    <a
                      href={href({ view: 'week', date: day })}
                      className="text-[11px] text-fg-muted underline hover:text-fg"
                    >
                      {fmt(m.readyMore, { n: list.length - MONTH_CARDS })}
                    </a>
                  ) : null}
                </div>
              )
            })}
          </div>
          {counts.published + counts.scheduled === 0 ? (
            <p className="px-1 pt-3 text-[13px] text-fg-muted">{m.emptyRange}</p>
          ) : null}
          <p className="px-1 pt-3 text-[12px] text-fg-subtle">{m.dragHint}</p>
        </Panel>

        <Panel className="xl:sticky xl:top-[76px] xl:self-start">
          <div className="mb-2 flex items-center gap-2">
            <CalendarClock size={15} className="text-warn" aria-hidden="true" />
            <h2 className="font-body text-[15px] font-bold normal-case tracking-normal">
              {m.readyTitle}
            </h2>
            <Pill tone={data.backlogTotal > 0 ? 'warn' : 'neutral'}>{data.backlogTotal}</Pill>
          </div>
          <p className="mb-3 text-[12.5px] leading-[17px] text-fg-muted">{m.readyLead}</p>
          {backlog.length === 0 ? (
            <p className="text-[13px] text-fg-subtle">{m.readyEmpty}</p>
          ) : (
            <ul className="flex max-h-[60vh] flex-col gap-1.5 overflow-auto">
              {backlog.map((c) => card(c, false))}
            </ul>
          )}
          {data.backlogTotal > backlog.length ? (
            <p className="pt-2 text-[12px] text-fg-subtle">
              {fmt(m.readyMore, { n: data.backlogTotal - backlog.length })}
            </p>
          ) : null}
        </Panel>
      </div>

      <Modal
        open={editing !== null}
        title={
          editing
            ? fmt(m.editTitle, {
                n: formatChapterNumber(editing.number),
                series: editing.seriesTitle,
              })
            : ''
        }
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {m.close}
            </Button>
            {editing && isMovable(editing) ? (
              <Button
                disabled={busy || !fromLocalInput(when)}
                onClick={async () => {
                  const at = fromLocalInput(when)
                  if (!editing || !at) return
                  if (await apply(editing, 'schedule', at)) setEditing(null)
                }}
              >
                {m.reschedule}
              </Button>
            ) : null}
          </>
        }
      >
        {editing && isMovable(editing) ? (
          <>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-fg-muted">
              {m.when}
              <input
                type="datetime-local"
                className={inputClass}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {canPublish ? (
                <button
                  type="button"
                  disabled={busy}
                  className="h-9 rounded-md border border-line bg-surface-2 px-3 text-[13px] font-semibold hover:bg-surface-3 disabled:opacity-50"
                  onClick={async () => {
                    if (editing && (await apply(editing, 'publish_now'))) setEditing(null)
                  }}
                >
                  {m.publishNow}
                </button>
              ) : null}
              {editing.publishedAt ? (
                <button
                  type="button"
                  disabled={busy}
                  className="h-9 rounded-md border border-line bg-surface-2 px-3 text-[13px] font-semibold hover:bg-surface-3 disabled:opacity-50"
                  onClick={async () => {
                    if (editing && (await apply(editing, 'unschedule'))) setEditing(null)
                  }}
                >
                  {m.unschedule}
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-fg-muted">{m.publishedLocked}</p>
        )}
        {editing ? (
          <a
            href={`/admin/series/${editing.seriesId}?tab=chapters`}
            className="text-[12.5px] text-fg-muted underline"
          >
            {editing.seriesTitle}
          </a>
        ) : null}
      </Modal>
    </div>
  )
}
