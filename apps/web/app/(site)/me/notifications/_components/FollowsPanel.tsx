'use client'

import { fmt, messages } from '@palscans/core/messages'
import { cn, RelativeTime, useToast } from '@palscans/ui'
import { useState, useTransition } from 'react'
import { FOLLOW_MODES, type FollowMode } from '@/lib/notifications/schema'
import { saveFollowMode, unfollowSeriesAction } from '../actions'

/**
 * Everything the reader is subscribed to, in one place (docs/17 §D): the series they
 * followed *and* the ones they only bookmarked, because both are being notified and a
 * screen that showed half of them would be lying about what happens next.
 *
 * Each row is a `<select>` rather than five buttons — forty rows of segmented controls is a
 * wall, and a select is the one control that is keyboard- and screen-reader-native on every
 * platform. Saving is per row and optimistic: nothing here batches, so there is no Save
 * button to forget to press.
 */
export interface FollowRowView {
  seriesId: number
  slug: string
  title: string
  coverUrl: string | null
  chapterCount: number
  lastChapterAt: string | null
  mode: FollowMode
  source: 'follow' | 'bookmark'
  /** The shelf it is also on, if any — a follow and a bookmark are different things. */
  bookmarkStatus: string | null
}

const shelfLabel = (status: string | null): string | null =>
  status ? ((messages.series.bookmarkStatus as Record<string, string>)[status] ?? null) : null

export function FollowsPanel({ initial }: { initial: FollowRowView[] }) {
  const m = messages.follows
  const { toast } = useToast()
  const [rows, setRows] = useState(initial)
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<number | null>(null)

  const pick = (seriesId: number, next: FollowMode) => {
    const previous = rows
    setRows((rs) =>
      rs.map((r) => (r.seriesId === seriesId ? { ...r, mode: next, source: 'follow' } : r)),
    )
    setBusyId(seriesId)
    startTransition(async () => {
      const res = await saveFollowMode(seriesId, next)
      setBusyId(null)
      if (!res.ok) setRows(previous)
      toast({ title: res.message, tone: res.ok ? 'ok' : 'danger' })
    })
  }

  /**
   * Unfollow. Not optimistic, because the outcome is not knowable from here: a series still
   * on a shelf is *muted* (the row has to stay, saying so, or the reader would think it had
   * left their library) and one that is not is removed outright.
   */
  const drop = (seriesId: number) => {
    setBusyId(seriesId)
    startTransition(async () => {
      const res = await unfollowSeriesAction(seriesId)
      setBusyId(null)
      if (!res.ok) {
        toast({ title: res.message, tone: 'danger' })
        return
      }
      setRows((rs) =>
        res.muted
          ? rs.map((r) =>
              r.seriesId === seriesId
                ? { ...r, mode: 'off' as const, source: 'follow' as const }
                : r,
            )
          : rs.filter((r) => r.seriesId !== seriesId),
      )
      toast({ title: res.message, tone: 'ok' })
    })
  }

  if (rows.length === 0)
    return (
      <div className="rounded-md border border-line-soft bg-bg p-5 text-center">
        <p className="m-0 text-sm text-fg">{m.empty}</p>
        <p className="mt-1 text-[12px] text-fg-muted">{m.emptyHint}</p>
      </div>
    )

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[68ch] text-[13px] text-fg-muted">{m.manageHint}</p>
      <ul className="m-0 flex list-none flex-col divide-y divide-line-soft overflow-hidden rounded-md border border-line p-0">
        {rows.map((row) => (
          <li
            key={row.seriesId}
            className={cn(
              'flex flex-wrap items-center gap-3 bg-bg p-3',
              busyId === row.seriesId && pending && 'opacity-60',
            )}
          >
            {row.coverUrl ? (
              <img
                src={row.coverUrl}
                alt=""
                width={32}
                height={45}
                loading="lazy"
                decoding="async"
                className="h-[45px] w-8 shrink-0 rounded-sm object-cover"
              />
            ) : (
              <span className="h-[45px] w-8 shrink-0 rounded-sm bg-surface-2" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">
              <a
                href={`/series/${row.slug}`}
                className="block truncate text-sm font-semibold text-fg hover:text-brand-hover"
              >
                {row.title}
              </a>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-muted">
                <span>{fmt(messages.series.chapterCount, { n: row.chapterCount })}</span>
                {row.lastChapterAt ? <RelativeTime iso={row.lastChapterAt} /> : null}
                {row.source === 'bookmark' ? (
                  <span className="rounded-full bg-surface-2 px-1.5 py-px font-semibold text-fg-subtle">
                    {m.viaBookmark}
                  </span>
                ) : shelfLabel(row.bookmarkStatus) ? (
                  <span className="rounded-full bg-surface-2 px-1.5 py-px font-semibold text-fg-subtle">
                    {shelfLabel(row.bookmarkStatus)}
                  </span>
                ) : null}
              </span>
            </span>
            <label className="flex items-center gap-2 text-[12px] text-fg-muted">
              <span className="sr-only">{`${m.settingsTitle}: ${row.title}`}</span>
              <select
                value={row.mode}
                disabled={pending && busyId === row.seriesId}
                onChange={(e) => pick(row.seriesId, e.target.value as FollowMode)}
                className="h-9 rounded-[8px] border border-line bg-surface-1 px-2 text-[13px] font-semibold text-fg"
              >
                {FOLLOW_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {m.modes[mode]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={pending && busyId === row.seriesId}
              onClick={() => drop(row.seriesId)}
              className="font-semibold text-[12px] text-fg-subtle hover:text-danger"
            >
              {m.unfollow}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
