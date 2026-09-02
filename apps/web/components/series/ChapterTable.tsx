'use client'

import { fmt, messages } from '@palscans/core/messages'
import { cn, RelativeTime } from '@palscans/ui'
import { Check, Lock, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChapterRowData } from '@/app/(site)/series/[slug]/data'

export interface ChapterTableProps {
  seriesSlug: string
  chapters: ChapterRowData[]
  readIds: number[]
  continueId: number | null
  /** Server time, ISO — the first render uses it so countdowns match between server and client. */
  now: string
  signedIn: boolean
}

type Sort = 'newest' | 'oldest'

const VIRTUAL_ABOVE = 200
const SSR_ROWS = 60
const OVERSCAN = 12

const chapterLabel = (n: number) =>
  fmt(messages.series.chapterShort, { n: String(Number.parseFloat(n.toFixed(3))) })
const longLabel = (n: number) =>
  fmt(messages.reader.chapterSelect, { n: String(Number.parseFloat(n.toFixed(3))) })

/** "2d 4h" · "4h 12m" · "35m" (mirrors @palscans/core `countdown`, kept local so the island stays tiny). */
const countdown = (untilIso: string, nowMs: number): string => {
  const diff = Math.max(0, Math.round((new Date(untilIso).getTime() - nowMs) / 1000))
  const d = Math.floor(diff / 86400)
  const h = Math.floor((diff % 86400) / 3600)
  const m = Math.floor((diff % 3600) / 60)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${Math.max(1, m)}m`
}

/**
 * The chapter list (docs/06): sticky search + Newest/Oldest + "unread only", lock state with
 * the explicit unlock time, read state, virtualised above 200 rows (window-scroll windowing
 * with fixed row heights; the first 60 rows are in the server HTML for crawlers).
 */
export function ChapterTable({
  seriesSlug,
  chapters,
  readIds,
  continueId,
  now,
  signedIn,
}: ChapterTableProps) {
  const [sort, setSort] = useState<Sort>('newest')
  const [query, setQuery] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [nowMs, setNowMs] = useState(() => new Date(now).getTime())
  const [rowH, setRowH] = useState(40)
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const read = useMemo(() => new Set(readIds), [readIds])

  useEffect(() => {
    setNowMs(Date.now())
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = chapters
    if (q) {
      const num = Number.parseFloat(q.replace(/^(ch\.?|chapter)\s*/i, ''))
      list = list.filter(
        (c) =>
          (Number.isFinite(num) && String(c.number).startsWith(String(num))) ||
          (c.title ?? '').toLowerCase().includes(q) ||
          longLabel(c.number).toLowerCase().includes(q),
      )
    }
    if (unreadOnly) list = list.filter((c) => !read.has(c.id))
    return sort === 'newest' ? list : [...list].reverse()
  }, [chapters, query, unreadOnly, sort, read])

  const virtual = rows.length > VIRTUAL_ABOVE

  // window-scroll virtualisation: measure where the list sits, render only the visible band
  useEffect(() => {
    if (!virtual) {
      setRange(null)
      return
    }
    const mq = window.matchMedia('(min-width: 768px)')
    const measure = () => {
      const h = mq.matches ? 40 : 56
      setRowH(h)
      const el = listRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      // both bounds clamped to [0, rows.length] and end >= start, so the spacers always sum to
      // rows.length * rowH — the table's height must not depend on scrollY
      const start = Math.min(
        rows.length,
        Math.max(0, Math.floor((window.scrollY - top) / h) - OVERSCAN),
      )
      const end = Math.max(
        start,
        Math.min(
          rows.length,
          Math.ceil((window.scrollY + window.innerHeight - top) / h) + OVERSCAN,
        ),
      )
      setRange((r) => (r && r.start === start && r.end === end ? r : { start, end }))
    }
    measure()
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    mq.addEventListener('change', measure)
    return () => {
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      mq.removeEventListener('change', measure)
    }
  }, [virtual, rows.length])

  const start = virtual ? (range?.start ?? 0) : 0
  const end = virtual ? (range?.end ?? Math.min(rows.length, SSR_ROWS)) : rows.length
  const slice = rows.slice(start, end)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 md:h-9">
        <h2 id="chapters-title" className="m-0 font-display text-xl font-bold tracking-[-0.01em]">
          {messages.series.chapters}
        </h2>
        <span className="text-[13px] font-medium text-fg-muted">
          {fmt(messages.seriesDetail.chapterSummary, {
            n: chapters.length.toLocaleString('en'),
            order:
              sort === 'newest'
                ? messages.seriesDetail.newestFirst
                : messages.seriesDetail.oldestFirst,
          })}
        </span>
        <div className="hidden flex-1 md:block" />
        <label className="flex h-9 w-full items-center gap-2 rounded-[10px] border border-line bg-surface-1 px-3 text-[13px] text-fg-muted focus-within:border-brand md:w-[240px]">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={messages.seriesDetail.searchChapters}
            aria-label={messages.seriesDetail.searchChapters}
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-muted"
          />
        </label>
        <div
          role="tablist"
          aria-label={messages.browse.sort}
          className="grid h-9 w-[160px] grid-cols-2 gap-1 rounded-[10px] border border-line bg-bg p-[3px] text-[13px] font-semibold"
        >
          {(['newest', 'oldest'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={sort === s}
              onClick={() => setSort(s)}
              className={cn(
                'flex items-center justify-center rounded-[7px] transition-colors',
                sort === s ? 'bg-brand-wash text-brand-hover' : 'text-fg-muted hover:text-fg',
              )}
            >
              {s === 'newest' ? messages.seriesDetail.newest : messages.seriesDetail.oldest}
            </button>
          ))}
        </div>
        {signedIn ? (
          <button
            type="button"
            role="switch"
            aria-checked={unreadOnly}
            onClick={() => setUnreadOnly((u) => !u)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-semibold transition-colors',
              unreadOnly
                ? 'border-brand/60 bg-brand-wash text-brand-hover'
                : 'border-line bg-surface-1 text-fg-muted hover:text-fg',
            )}
          >
            <Check size={14} aria-hidden="true" className={cn(!unreadOnly && 'opacity-40')} />
            {messages.seriesDetail.unreadOnly}
          </button>
        ) : null}
      </div>

      <div className="mt-3 overflow-hidden rounded-[12px] border border-line bg-surface-1">
        <div className="hidden h-[34px] items-center border-b border-line bg-surface-2 px-4 text-[12px] font-semibold text-fg-muted md:flex">
          <span className="w-24">{messages.seriesDetail.colChapter}</span>
          <span className="flex-1">{messages.seriesDetail.colTitle}</span>
          <span className="w-[150px]">{messages.seriesDetail.colReleased}</span>
          <span className="w-[120px] text-right">{messages.seriesDetail.colAccess}</span>
        </div>
        {rows.length === 0 ? (
          <p className="m-0 px-4 py-8 text-center text-sm text-fg-muted">
            {chapters.length === 0
              ? messages.series.emptyChapters
              : messages.seriesDetail.noChaptersMatch}
          </p>
        ) : (
          <div ref={listRef}>
            {virtual && start > 0 ? (
              <div style={{ height: start * rowH }} aria-hidden="true" />
            ) : null}
            {slice.map((c, i) => {
              const index = start + i
              const isRead = read.has(c.id)
              const highlight =
                c.id === continueId ||
                (index === 0 && sort === 'newest' && c.lock === 'early_access')
              const lockLabel =
                c.lock === 'early_access' && c.earlyAccessUntil
                  ? fmt(messages.seriesDetail.freeIn, {
                      countdown: countdown(c.earlyAccessUntil, nowMs),
                    })
                  : c.lock === 'premium'
                    ? messages.seriesDetail.premium
                    : null
              return (
                <a
                  key={c.id}
                  href={`/series/${seriesSlug}/chapter-${Number.parseFloat(c.number.toFixed(3))}`}
                  aria-current={c.id === continueId ? 'true' : undefined}
                  className={cn(
                    'flex h-14 items-center px-4 text-sm text-fg transition-colors hover:bg-brand/8 md:h-10',
                    highlight ? 'bg-brand/6' : index % 2 === 1 ? 'bg-fg/[0.025]' : 'bg-transparent',
                    isRead && 'text-fg-subtle',
                  )}
                >
                  <span
                    className={cn(
                      'flex w-[72px] shrink-0 items-center gap-1.5 tabular-nums md:w-24',
                      index === 0 && sort === 'newest'
                        ? 'font-bold text-brand-hover'
                        : 'font-semibold',
                      isRead && 'text-fg-subtle',
                    )}
                  >
                    {isRead ? (
                      <Check size={14} aria-label={messages.series.read} className="shrink-0" />
                    ) : null}
                    {chapterLabel(c.number)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-2.5">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="truncate font-medium">{c.title ?? longLabel(c.number)}</span>
                      {c.lock === 'early_access' ? (
                        <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-gold/12 px-2 text-[11px] font-bold text-gold">
                          {messages.series.earlyAccess}
                        </span>
                      ) : null}
                    </span>
                    {c.publishedAt ? (
                      <RelativeTime
                        iso={c.publishedAt}
                        className="text-[12px] text-fg-muted md:hidden"
                      />
                    ) : null}
                  </span>
                  <span className="hidden w-[150px] shrink-0 text-fg-muted md:block">
                    {c.publishedAt ? <RelativeTime iso={c.publishedAt} /> : null}
                  </span>
                  <span
                    className={cn(
                      'flex w-[92px] shrink-0 items-center justify-end gap-1.5 text-[12px] md:w-[120px]',
                      lockLabel ? 'font-semibold text-gold' : 'font-medium text-fg-muted',
                    )}
                  >
                    {lockLabel ? (
                      <>
                        <Lock size={14} aria-hidden="true" />
                        {lockLabel}
                      </>
                    ) : (
                      messages.seriesDetail.free
                    )}
                  </span>
                </a>
              )
            })}
            {virtual && end < rows.length ? (
              <div style={{ height: (rows.length - end) * rowH }} aria-hidden="true" />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
