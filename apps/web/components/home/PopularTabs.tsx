'use client'

import { fmt, messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import Link from 'next/link'
import { useId, useState } from 'react'

export type PopularWindowKey = 'weekly' | 'monthly' | 'all'

export interface PopularRowData {
  id: number
  rank: number
  title: string
  href: string
  coverSrc: string
  coverWidth: number
  coverHeight: number
  /** "Manhwa · Ongoing · Ch. 301" */
  meta: string
  rating: number | null
  mature: boolean
}

export interface PopularTabsProps {
  lists: Record<PopularWindowKey, PopularRowData[]>
  initial?: PopularWindowKey
}

const WINDOWS: ReadonlyArray<{ key: PopularWindowKey; label: string }> = [
  { key: 'weekly', label: messages.home.popularWeekly },
  { key: 'monthly', label: messages.home.popularMonthly },
  { key: 'all', label: messages.home.popularAllTime },
]

/**
 * Popular sidebar tabs. All three lists arrive server-rendered; switching is a state change,
 * so the Weekly list is in the HTML for crawlers and the others cost no request.
 */
export function PopularTabs({ lists, initial = 'weekly' }: PopularTabsProps) {
  const [window, setWindow] = useState<PopularWindowKey>(initial)
  const baseId = useId()
  const rows = lists[window]
  return (
    <div className="rounded-[10px] border border-line bg-surface-1 p-2.5">
      <div className="mb-1.5 flex h-6 items-end justify-between border-b border-line">
        <h2 className="section-title pb-1 text-[16px] leading-5">{messages.home.popular}</h2>
        <div
          role="tablist"
          aria-label={messages.home.popular}
          className="-mb-px flex gap-3 text-[12px] font-semibold"
        >
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              role="tab"
              id={`${baseId}-tab-${w.key}`}
              aria-selected={window === w.key}
              aria-controls={`${baseId}-panel-${w.key}`}
              onClick={() => setWindow(w.key)}
              className={cn(
                'border-b-2 pb-[3px] transition-colors duration-[120ms]',
                window === w.key
                  ? 'border-brand text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <ol
        role="tabpanel"
        id={`${baseId}-panel-${window}`}
        aria-labelledby={`${baseId}-tab-${window}`}
        className="flex flex-col"
      >
        {rows.map((r) => (
          <li key={r.id} className="flex h-[66px] items-center gap-2">
            <span
              className={cn(
                'w-5 shrink-0 text-center font-display text-[15px] font-extrabold tabular-nums',
                r.rank <= 3 ? 'text-brand-hover' : 'text-fg-muted',
              )}
            >
              {r.rank}
            </span>
            <Link
              href={r.href}
              tabIndex={-1}
              aria-hidden="true"
              className="group block h-[66px] w-11 shrink-0 overflow-hidden rounded-[5px] bg-surface-2"
            >
              <img
                src={r.coverSrc}
                alt=""
                width={r.coverWidth}
                height={r.coverHeight}
                loading="lazy"
                decoding="async"
                className={cn(
                  'h-full w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.04]',
                  r.mature && 'blur-md',
                )}
              />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={r.href}
                className="block truncate text-[13px] font-bold leading-[17px] text-fg hover:text-brand-hover"
              >
                {r.title}
              </Link>
              <p className="mt-px truncate text-[13px] leading-[17px] text-fg-muted">{r.meta}</p>
            </div>
            {r.rating !== null ? (
              <span
                role="img"
                className="inline-flex shrink-0 items-center gap-[3px] text-[12px] font-bold tabular-nums text-gold"
                aria-label={fmt(messages.series.rated, { score: r.rating.toFixed(1) })}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
                </svg>
                {r.rating.toFixed(1)}
              </span>
            ) : null}
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="py-6 text-center text-[13px] text-fg-subtle">
            {messages.home.emptyUpdates}
          </li>
        ) : null}
      </ol>
    </div>
  )
}
