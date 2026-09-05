'use client'

import { fmt, messages } from '@palscans/core/messages'
import { cn, Sheet, useToast } from '@palscans/ui'
import { Bookmark, Check, Download, FileArchive, Lock, Smartphone, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChapterRowData } from '@/app/(site)/series/[slug]/data'
import { del, postJson } from '@/lib/comments/client'
import { useChapterDownload, useIsDownloaded } from '@/lib/offline/useDownloads'

const ghost =
  'inline-flex h-11 items-center gap-2 rounded-[12px] border border-line bg-transparent px-4 text-sm font-semibold text-fg transition-colors hover:border-brand hover:bg-brand-wash disabled:opacity-60'

interface Common {
  seriesId: number
  seriesSlug: string
  signedIn: boolean
}

const signInHref = (slug: string) => `/login?next=${encodeURIComponent(`/series/${slug}`)}`

/** Bookmark toggle — posts to /api/series/[id]/bookmark (docs/06 "Primary actions"). */
export function BookmarkButton({
  seriesId,
  seriesSlug,
  signedIn,
  initial,
}: Common & { initial: boolean }) {
  const { toast } = useToast()
  const [on, setOn] = useState(initial)
  const [busy, setBusy] = useState(false)
  if (!signedIn)
    return (
      <a href={signInHref(seriesSlug)} className={ghost}>
        <Bookmark size={18} aria-hidden="true" />
        {messages.series.bookmark}
      </a>
    )
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={busy}
      className={cn(ghost, on && 'border-brand/60 bg-brand-wash text-brand-hover')}
      onClick={async () => {
        setBusy(true)
        const next = !on
        setOn(next)
        const res = next
          ? await postJson<{ message: string }>(`/api/series/${seriesId}/bookmark`, {
              status: 'reading',
            })
          : await del<{ message: string }>(`/api/series/${seriesId}/bookmark`)
        setBusy(false)
        if (!res.ok) {
          setOn(!next)
          toast({ title: res.message || messages.errors.generic, tone: 'danger' })
          return
        }
        toast({ title: res.data.message, tone: 'ok' })
      }}
    >
      <Bookmark size={18} aria-hidden="true" fill={on ? 'currentColor' : 'none'} />
      {on ? messages.series.bookmarked : messages.series.bookmark}
    </button>
  )
}

/** Rate 1–10 — a popover of ten stars posting to /api/series/[id]/rating. */
export function RateButton({
  seriesId,
  seriesSlug,
  signedIn,
  initial,
}: Common & { initial: number | null }) {
  const { toast } = useToast()
  const [score, setScore] = useState<number | null>(initial)
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!signedIn)
    return (
      <a href={signInHref(seriesSlug)} className={ghost}>
        <Star size={18} aria-hidden="true" />
        {messages.series.rate}
      </a>
    )

  const save = async (value: number | null) => {
    setBusy(true)
    const res =
      value === null
        ? await del<{ message: string }>(`/api/series/${seriesId}/rating`)
        : await postJson<{ message: string }>(`/api/series/${seriesId}/rating`, { score: value })
    setBusy(false)
    if (!res.ok) {
      toast({ title: res.message || messages.errors.generic, tone: 'danger' })
      return
    }
    setScore(value)
    setOpen(false)
    toast({ title: res.data.message, tone: 'ok' })
  }

  const shown = hover ?? score ?? 0
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className={cn(ghost, score !== null && 'border-gold/60 text-gold')}
      >
        <Star size={18} aria-hidden="true" fill={score !== null ? 'currentColor' : 'none'} />
        {score !== null ? fmt(messages.series.rated, { score }) : messages.series.rate}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-20 mt-2 w-[300px] rounded-[12px] border border-line bg-surface-2 p-3 shadow-2">
          <div className="text-sm font-semibold">{messages.seriesDetail.rateTitle}</div>
          <div className="mt-0.5 text-[12px] text-fg-muted">{messages.seriesDetail.rateHint}</div>
          <fieldset
            className="m-0 mt-2 flex gap-0.5 border-0 p-0"
            onMouseLeave={() => setHover(null)}
          >
            <legend className="sr-only">{messages.seriesDetail.rateTitle}</legend>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} / 10`}
                onMouseEnter={() => setHover(n)}
                onFocus={() => setHover(n)}
                onClick={() => void save(n)}
                className={cn(
                  'inline-flex size-7 items-center justify-center rounded-sm',
                  n <= shown ? 'text-gold' : 'text-fg-subtle hover:text-gold',
                )}
              >
                <Star size={18} fill={n <= shown ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
            ))}
          </fieldset>
          <div className="mt-2 flex items-center justify-between text-[12px] text-fg-muted">
            <span className="tabular-nums">
              {shown > 0 ? fmt(messages.seriesDetail.yourRating, { score: shown }) : ''}
            </span>
            {score !== null ? (
              <button
                type="button"
                onClick={() => void save(null)}
                className="font-semibold text-danger hover:underline"
              >
                {messages.seriesDetail.removeRating}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const rowButton =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-line px-2.5 font-semibold text-[12px] transition-colors hover:border-brand disabled:opacity-60'

/**
 * Save the chapter as a file (`GET /api/chapters/:id/cbz`).
 *
 * The response is fetched rather than followed as a link so the entitlement and rate-limit
 * answers arrive as a toast instead of as a JSON file in the reader's downloads folder. The
 * server streams the archive; only the browser ever holds the finished bytes, which is the
 * right place for them.
 */
function SaveFileButton({ chapter }: { chapter: ChapterRowData }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/chapters/${chapter.id}/cbz`, { credentials: 'same-origin' })
      if (!res.ok) {
        toast({
          title:
            res.status === 429
              ? messages.series.downloadCbzTooMany
              : messages.series.downloadCbzFailed,
          tone: 'danger',
        })
        return
      }
      const disposition = res.headers.get('content-disposition') ?? ''
      const named = /filename="([^"]+)"/.exec(disposition)?.[1]
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = named ?? `chapter-${chapter.number}.cbz`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoked late: Safari needs the object URL to outlive the click it just handled.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      toast({ title: messages.series.downloadCbzFailed, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" disabled={busy} className={rowButton} onClick={() => void save()}>
      {busy ? (
        messages.series.downloadCbzWorking
      ) : (
        <>
          <FileArchive size={13} aria-hidden="true" />
          {messages.series.downloadCbz}
        </>
      )}
    </button>
  )
}

/** The two meanings of "download", side by side, so the choice in each row is obvious. */
function DownloadKinds() {
  const m = messages.series
  const kinds = [
    { icon: Smartphone, title: m.downloadOfflineTitle, hint: m.downloadOfflineHint },
    { icon: FileArchive, title: m.downloadFileTitle, hint: m.downloadFileHint },
  ]
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {kinds.map(({ icon: Icon, title, hint }) => (
        <div key={title} className="rounded-[10px] border border-line bg-surface-2 p-3">
          <div className="flex items-center gap-1.5 font-semibold text-[13px]">
            <Icon size={14} aria-hidden="true" className="text-brand-hover" />
            {title}
          </div>
          <p className="mt-1 text-[12px] leading-[17px] text-fg-muted">{hint}</p>
        </div>
      ))}
    </div>
  )
}

/** One row in the download sheet: its own progress, so several can run in sequence. */
function DownloadRow({ chapter, onChanged }: { chapter: ChapterRowData; onChanged: () => void }) {
  const { downloaded, recheck } = useIsDownloaded(chapter.id)
  const { state, start } = useChapterDownload()
  const label = fmt(messages.series.chapterShort, {
    n: String(Number.parseFloat(chapter.number.toFixed(3))),
  })

  const working = state.status === 'working'
  return (
    <li className="flex items-center gap-2 border-line border-b py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-semibold tabular-nums">{label}</span>
        {chapter.title ? <span className="text-fg-muted"> · {chapter.title}</span> : null}
      </span>
      {downloaded ? (
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 font-semibold text-[12px] text-fg-muted hover:text-danger"
          onClick={async () => {
            const { removeChapter } = await import('@/lib/offline/cache')
            await removeChapter(chapter.id).catch(() => undefined)
            await recheck()
            onChanged()
          }}
        >
          <Check size={13} aria-hidden="true" className="text-ok" />
          {messages.series.downloadDone}
        </button>
      ) : (
        <button
          type="button"
          disabled={working}
          className={rowButton}
          onClick={async () => {
            const done = await start(chapter.id)
            if (done) {
              await recheck()
              onChanged()
            }
          }}
        >
          {working ? (
            fmt(messages.series.downloadWorking, {
              done: String(state.progress.done),
              total: String(state.progress.total),
            })
          ) : (
            <>
              <Smartphone size={13} aria-hidden="true" />
              {messages.series.downloadStart}
            </>
          )}
        </button>
      )}
      <SaveFileButton chapter={chapter} />
    </li>
  )
}

/**
 * Download — entitlement-gated (docs/06, docs/17 §G). Entitled readers get a list of the
 * chapters they can actually read, each downloadable on its own; everyone else gets the
 * Premium gate. Only `canRead` chapters appear: offering a download that would 403 is worse
 * than not offering one.
 */
export function DownloadButton({
  entitled,
  chapters = [],
}: {
  entitled: boolean
  chapters?: ChapterRowData[]
}) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState(0)
  const readable = chapters.filter((c) => c.canRead && c.pageCount > 0)

  return (
    <>
      <button type="button" className={ghost} onClick={() => setOpen(true)}>
        <Download size={18} aria-hidden="true" />
        {messages.series.download}
        {!entitled ? (
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-gold/12 px-[7px] font-bold text-[11px] text-gold">
            <Lock size={10} aria-hidden="true" />
            {messages.seriesDetail.premium}
          </span>
        ) : null}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={entitled ? messages.series.download : messages.seriesDetail.premiumGateTitle}
      >
        <div className="flex flex-col gap-4 p-4">
          {entitled ? (
            <>
              <p className="text-fg-muted text-sm">{messages.seriesDetail.downloadHint}</p>
              <DownloadKinds />
              {readable.length === 0 ? (
                <p className="text-fg-subtle text-sm">{messages.series.emptyChapters}</p>
              ) : (
                <ul
                  key={version}
                  className="m-0 max-h-[50vh] list-none overflow-y-auto overscroll-contain p-0"
                >
                  {readable.map((c) => (
                    <DownloadRow
                      key={c.id}
                      chapter={c}
                      onChanged={() => setVersion((v) => v + 1)}
                    />
                  ))}
                </ul>
              )}
              <a
                href="/me/downloads"
                className="text-[13px] font-semibold text-brand-hover hover:underline"
              >
                {messages.me.downloads.title}
              </a>
            </>
          ) : (
            <>
              <p className="text-fg-muted text-sm">{messages.seriesDetail.premiumGateBody}</p>
              <ul className="flex flex-col gap-1.5 text-sm">
                {[
                  messages.premium.bullets.adFree,
                  messages.premium.bullets.earlyAccess,
                  messages.premium.bullets.offline,
                ].map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <Star size={14} className="text-gold" fill="currentColor" aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
              <a
                href="/subscribe"
                className="inline-flex h-11 items-center justify-center rounded-[12px] bg-brand px-5 font-bold text-[15px] text-brand-ink hover:bg-brand-hover"
              >
                {messages.seriesDetail.premiumGateCta}
              </a>
            </>
          )}
        </div>
      </Sheet>
    </>
  )
}
