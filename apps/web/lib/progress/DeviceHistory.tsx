'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, Chip, EmptyState, RelativeTime, type SeriesType } from '@palscans/ui'
import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DeviceOnlyNote, DeviceStorageWarning } from './DeviceProgress'
import { clearLocalProgress, localHistory } from './local'
import type { LocalProgress } from './types'

/**
 * `/me/history` for a reader with no account: the same list, read out of this browser
 * instead of `chapter_reads`.
 *
 * Signing in is not a prerequisite for having read something, and sending a signed-out
 * reader to a login wall when they ask what they have been reading is exactly the moment
 * they stop coming back. What they get here is honestly labelled — this browser only, gone
 * if they clear it — with the way to make it permanent one link away.
 */

const seriesType = (type: string): SeriesType =>
  type === 'manhwa' || type === 'manhua' || type === 'manga' ? type : 'comic'

export function DeviceHistory({ signInHref }: { signInHref: string }) {
  const [rows, setRows] = useState<LocalProgress[] | null>(null)

  useEffect(() => {
    let live = true
    void localHistory().then((r) => {
      if (live) setRows(r)
    })
    return () => {
      live = false
    }
  }, [])

  const clear = useCallback(async () => {
    if (!window.confirm(messages.localProgress.clearConfirm)) return
    await clearLocalProgress()
    setRows([])
  }, [])

  // `null` is "not read yet" — one frame, and rendering an empty state through it would
  // flash "nothing here" at a reader who has read a hundred chapters.
  if (rows === null) return null

  if (rows.length === 0)
    return (
      <div className="flex flex-col gap-4">
        <DeviceStorageWarning />
        <EmptyState
          title={messages.localProgress.historyEmpty}
          action={
            <Button href="/browse" variant="outline">
              {messages.me.bookmarks.browse}
            </Button>
          }
        />
      </div>
    )

  return (
    <div className="flex flex-col gap-3">
      <DeviceStorageWarning />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DeviceOnlyNote signInHref={signInHref} />
        <Button variant="outline" size="sm" onClick={clear}>
          <Trash2 size={14} aria-hidden="true" />
          {messages.localProgress.clear}
        </Button>
      </div>
      <ol className="divide-y divide-line-soft rounded-lg border border-line bg-surface-1">
        {rows.map((row) => (
          <li key={row.chapterId} className="flex items-center gap-3 p-3">
            <a href={row.seriesHref} className="shrink-0 overflow-hidden rounded-sm bg-surface-2">
              {row.coverSrc ? (
                <img
                  src={row.coverSrc}
                  alt=""
                  width={400}
                  height={600}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[2/3] w-10 object-cover"
                />
              ) : (
                <span className="block aspect-[2/3] w-10" />
              )}
            </a>
            <div className="min-w-0 flex-1">
              <a
                href={row.seriesHref}
                className="line-clamp-1 text-sm font-bold text-fg hover:text-brand-hover"
              >
                {row.seriesTitle}
              </a>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-muted">
                <Chip variant="type" value={seriesType(row.seriesType)} size="sm" />
                <span>{fmt(messages.me.history.chapter, { n: row.chapterNumber })}</span>
                {row.pageCount > 0 ? (
                  <span>
                    ·{' '}
                    {fmt(messages.localProgress.position, {
                      n: row.pageIdx + 1,
                      total: row.pageCount,
                    })}
                  </span>
                ) : null}
                <span>
                  · <RelativeTime iso={new Date(row.updatedAt).toISOString()} />
                </span>
              </p>
            </div>
            <Button href={row.chapterHref} variant="outline" size="sm">
              {messages.me.history.continue}
            </Button>
          </li>
        ))}
      </ol>
    </div>
  )
}
