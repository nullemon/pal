'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Chip, useToast } from '@palscans/ui'
import { X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { BOOKMARK_STATUSES, type BookmarkStatus } from '@/lib/auth/schemas'
import { api, selectClasses } from './api'

export interface BookmarkItem {
  seriesId: number
  slug: string
  title: string
  type: 'manga' | 'manhwa' | 'manhua' | 'comic' | 'novel'
  cover: string
  status: BookmarkStatus
  latestChapter: number | null
  lastChapterAt: string | null
}

export function BookmarkCard({ item }: { item: BookmarkItem }) {
  const router = useRouter()
  const toast = useToast()
  const [status, setStatus] = useState<BookmarkStatus>(item.status)
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)

  const change = async (next: BookmarkStatus) => {
    const prev = status
    setStatus(next)
    setBusy(true)
    const res = await api<{ message: string }>(
      `/api/me/bookmarks/${item.seriesId}`,
      { status: next },
      'PATCH',
    )
    setBusy(false)
    if (!res.ok) {
      setStatus(prev)
      toast.toast({ title: res.message })
      return
    }
    toast.toast({ title: res.data.message })
    router.refresh()
  }

  const remove = async () => {
    setBusy(true)
    const res = await api<{ message: string }>(
      `/api/me/bookmarks/${item.seriesId}`,
      undefined,
      'DELETE',
    )
    setBusy(false)
    if (!res.ok) {
      toast.toast({ title: res.message })
      return
    }
    setGone(true)
    toast.toast({ title: res.data.message })
    router.refresh()
  }

  if (gone) return null
  const href = `/series/${item.slug}`
  return (
    <article className="group flex gap-3 rounded-lg border border-line bg-surface-1 p-3">
      <a href={href} className="shrink-0 overflow-hidden rounded-md bg-surface-2">
        <img
          src={item.cover}
          alt=""
          width={400}
          height={600}
          loading="lazy"
          decoding="async"
          className="aspect-[2/3] w-[72px] object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.04] sm:w-[84px]"
        />
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <a
            href={href}
            className="line-clamp-2 text-sm font-bold leading-tight text-fg hover:text-brand-hover"
          >
            {item.title}
          </a>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            aria-label={messages.me.bookmarks.remove}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:bg-surface-2 hover:text-danger"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
          {item.type === 'novel' ? (
            <Chip variant="genre" size="sm">
              {messages.series.type.novel}
            </Chip>
          ) : (
            <Chip variant="type" value={item.type} size="sm" />
          )}
          {item.latestChapter !== null ? (
            <span>
              {fmt(messages.me.bookmarks.latest, {
                chapter: fmt(messages.series.chapterShort, { n: item.latestChapter }),
              })}
            </span>
          ) : null}
        </div>
        <div className="mt-auto flex items-center gap-2">
          <label className="sr-only" htmlFor={`status-${item.seriesId}`}>
            {messages.me.bookmarks.changeStatus}
          </label>
          <select
            id={`status-${item.seriesId}`}
            value={status}
            disabled={busy}
            onChange={(e) => change(e.target.value as BookmarkStatus)}
            className={selectClasses}
          >
            {BOOKMARK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {messages.series.bookmarkStatus[s]}
              </option>
            ))}
          </select>
          {item.latestChapter !== null ? (
            <a
              href={`/series/${item.slug}/chapter-${item.latestChapter}`}
              className="text-[12px] font-semibold text-brand-hover hover:underline"
            >
              {messages.series.read}
            </a>
          ) : null}
        </div>
      </div>
    </article>
  )
}
