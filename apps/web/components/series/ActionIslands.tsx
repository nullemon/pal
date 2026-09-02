'use client'

import { fmt, messages } from '@palscans/core/messages'
import { cn, Sheet, useToast } from '@palscans/ui'
import { Bookmark, Download, Lock, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { del, postJson } from '@/lib/comments/client'

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

/** Download — entitlement-gated (docs/06). Non-entitled readers see the Premium gate. */
export function DownloadButton({ entitled }: { entitled: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={ghost} onClick={() => setOpen(true)}>
        <Download size={18} aria-hidden="true" />
        {messages.series.download}
        {!entitled ? (
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-gold/12 px-[7px] text-[11px] font-bold text-gold">
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
            <p className="text-sm text-fg-muted">{messages.seriesDetail.downloadHint}</p>
          ) : (
            <>
              <p className="text-sm text-fg-muted">{messages.seriesDetail.premiumGateBody}</p>
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
                className="inline-flex h-11 items-center justify-center rounded-[12px] bg-brand px-5 text-[15px] font-bold text-brand-ink hover:bg-brand-hover"
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
