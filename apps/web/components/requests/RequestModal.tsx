'use client'

import { messages } from '@palscans/core/messages'
import { buttonClasses, cn, Sheet, useToast } from '@palscans/ui'
import { ArrowRight, BookOpen, Check, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { TurnstileWidget } from '@/components/comments/TurnstileWidget'
import { SERIES_TYPES } from '@/components/discovery/taxonomy'
import { fetchSuggestions, postRequest } from './api'
import { RequestCard } from './RequestCard'
import type { RequestItem, SeriesMatch, Suggestions } from './shared'

const m = messages.requests

const field =
  'w-full rounded-[10px] border border-line bg-surface-2 px-3 text-[15px] text-fg outline-none placeholder:text-fg-subtle focus:border-brand'
const label = 'flex flex-col gap-1 text-[13px] font-semibold text-fg'

/** The modal only asks Postgres once the reader has stopped typing for this long. */
const DEBOUNCE_MS = 250
const EMPTY: Suggestions = { q: '', series: [], requests: [], duplicateId: null }

function SeriesHit({ hit, onNavigate }: { hit: SeriesMatch; onNavigate: () => void }) {
  return (
    <li>
      <Link
        href={hit.href}
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-lg border border-line bg-surface-1 p-2.5 hover:border-brand"
      >
        {/* A 36px thumbnail inside a modal that may never open does not warrant
            next/image's runtime; `noImgElement` is off for the repo. */}
        <img
          src={hit.coverSrc}
          alt=""
          width={36}
          height={48}
          loading="lazy"
          className="h-12 w-9 shrink-0 rounded-sm object-cover"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[14px] font-extrabold text-fg">
            {hit.title}
          </span>
          <span className="block text-[12px] text-fg-subtle">{m.onSiteHint}</span>
        </span>
        <BookOpen size={16} aria-hidden="true" className="shrink-0 text-fg-muted" />
      </Link>
    </li>
  )
}

export interface RequestModalProps {
  open: boolean
  onClose: () => void
  turnstileSiteKey: string | null
  signedIn: boolean
}

/**
 * "Request a series", opened from the header on any page.
 *
 * The reader types the title first and everything else second, because the title is the only
 * field that matters and the only one we can answer immediately: while they type, this asks
 * `/api/requests/suggest` for series the site already carries and requests somebody has
 * already filed. Both answers are shown *above* the rest of the form, so upvoting is the
 * path of least resistance and filing a duplicate takes more effort than not filing one.
 *
 * The dialog itself is `Sheet` from @palscans/ui — the same bottom-sheet-on-mobile,
 * centred-dialog-on-desktop component the reader settings and the download sheet use. It is
 * a native `<dialog>` opened with `showModal()`, so the focus trap, Escape, the top layer and
 * returning focus to the trigger on close are the browser's, not ours.
 */
export function RequestModal({ open, onClose, turnstileSiteKey, signedIn }: RequestModalProps) {
  const { toast } = useToast()
  const id = useId()
  const [title, setTitle] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestions>(EMPTY)
  const [searching, setSearching] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<RequestItem | null>(null)
  const [done, setDone] = useState<RequestItem | null>(null)
  const [token, setToken] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const clearToken = useCallback(() => setToken(''), [])

  // A fresh dialog every time: nothing from the last request is still on screen.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setSuggestions(EMPTY)
    setShowDetails(false)
    setError(null)
    setDuplicate(null)
    setDone(null)
    // `showModal` focuses the dialog; put the caret where the reader is going to type.
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [open])

  // Live search, debounced and abortable: the last keystroke is the only query that matters.
  useEffect(() => {
    const q = title.trim()
    if (!open || q.length < 2) {
      setSuggestions(EMPTY)
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(async () => {
      const res = await fetchSuggestions(q, controller.signal)
      if (controller.signal.aborted) return
      setSearching(false)
      if (res.ok) setSuggestions(res.data)
    }, DEBOUNCE_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [title, open])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const value = String(form.get('title') ?? '').trim()
    if (value.length < 2) {
      setError(m.titleRequired)
      return
    }
    setBusy(true)
    setError(null)
    const res = await postRequest({
      title: value,
      altTitles: String(form.get('altTitles') ?? ''),
      link: String(form.get('link') ?? ''),
      type: String(form.get('type') ?? ''),
      note: String(form.get('note') ?? ''),
      website: String(form.get('website') ?? ''),
      turnstile: token,
    })
    setBusy(false)
    // Turnstile tokens are single-use: a rejected submission must not resubmit a spent one.
    setToken('')
    setResetKey((n) => n + 1)
    if (res.ok) {
      setDone(res.data.request)
      return
    }
    if (res.error === 'duplicate' && res.request) {
      setDuplicate(res.request)
      setError(m.duplicate)
      return
    }
    const message =
      res.status === 429
        ? m.rateLimited
        : res.error === 'challenge_failed'
          ? m.challengeFailed
          : res.message || m.failed
    setError(message)
    toast({ title: message, tone: 'danger' })
  }

  // The row the submission was refused for is shown in its own panel below; showing it in
  // the suggestion list as well would just be the same card twice.
  const visibleRequests = suggestions.requests.filter((r) => r.id !== duplicate?.id)
  const hasMatches = suggestions.series.length > 0 || visibleRequests.length > 0
  const typed = title.trim().length >= 2

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={m.modalTitle}
      className="md:w-[min(620px,calc(100vw-2rem))]"
    >
      {done ? (
        <div className="flex flex-col gap-4">
          <p
            role="status"
            className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-[14px] text-fg"
          >
            {signedIn ? m.sent : m.sentAnon}
          </p>
          <ul className="flex flex-col gap-2">
            <RequestCard item={done} compact />
          </ul>
          <div className="flex items-center gap-2">
            <Link href="/requests" className={buttonClasses('outline', 'sm')} onClick={onClose}>
              {m.seeAll}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <button type="button" onClick={onClose} className={buttonClasses('primary', 'sm')}>
              {m.close}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-[13px] leading-5 text-fg-muted">{m.modalLead}</p>

          <div className="flex flex-col gap-1.5">
            <label className={label} htmlFor={`${id}-title`}>
              {m.searchLabel}
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id={`${id}-title`}
                name="title"
                required
                maxLength={200}
                autoComplete="off"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  setDuplicate(null)
                  setError(null)
                }}
                placeholder={m.searchPlaceholder}
                aria-describedby={`${id}-matches`}
                className={cn(field, 'h-11 pr-9')}
              />
              {searching ? (
                <Loader2
                  size={16}
                  aria-hidden="true"
                  className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-fg-subtle"
                />
              ) : null}
            </div>
          </div>

          {/* The whole point of the modal: what you are about to ask for may already be
              here, or already asked for. Announced politely so it reaches a screen reader
              without stealing focus from the field. */}
          <div id={`${id}-matches`} aria-live="polite" className="flex flex-col gap-3 empty:hidden">
            {!typed ? (
              <p className="text-[12.5px] text-fg-subtle">{m.keepTyping}</p>
            ) : suggestions.series.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
                  {m.onSite}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {suggestions.series.map((hit) => (
                    <SeriesHit key={hit.id} hit={hit} onNavigate={onClose} />
                  ))}
                </ul>
              </section>
            ) : null}

            {typed && visibleRequests.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
                  {m.alreadyRequested}
                </h3>
                <p className="text-[12.5px] text-fg-muted">{m.alreadyRequestedHint}</p>
                <ul className="flex flex-col gap-1.5">
                  {visibleRequests.map((item) => (
                    <RequestCard
                      key={item.id}
                      item={item}
                      compact
                      onChange={(next) =>
                        setSuggestions((s) => ({
                          ...s,
                          requests: s.requests.map((r) => (r.id === next.id ? next : r)),
                        }))
                      }
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {typed && !searching && !hasMatches && !duplicate ? (
              <p className="inline-flex items-center gap-1.5 text-[12.5px] text-ok">
                <Check size={13} aria-hidden="true" />
                {m.noMatches}
              </p>
            ) : null}
          </div>

          {duplicate ? (
            <div className="flex flex-col gap-1.5 rounded-lg border border-warn/40 bg-warn/10 p-3">
              <p className="text-[13px] font-semibold text-fg">{m.duplicate}</p>
              <ul className="flex flex-col gap-1.5">
                <RequestCard item={duplicate} compact onChange={(next) => setDuplicate(next)} />
              </ul>
            </div>
          ) : error ? (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          ) : null}

          <div className="border-t border-line-soft pt-3">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
              className="text-[13px] font-semibold text-fg-muted hover:text-fg"
            >
              {m.details}
            </button>
            {showDetails ? (
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className={label} htmlFor={`${id}-alt`}>
                    {m.altTitles}
                    <span className="text-[12px] font-normal text-fg-muted">{m.altTitlesHint}</span>
                  </label>
                  <textarea
                    id={`${id}-alt`}
                    name="altTitles"
                    rows={2}
                    className={cn(field, 'py-2 text-[14px]')}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={label} htmlFor={`${id}-link`}>
                      {m.link}
                      <span className="text-[12px] font-normal text-fg-muted">{m.linkHint}</span>
                    </label>
                    <input
                      id={`${id}-link`}
                      name="link"
                      type="url"
                      inputMode="url"
                      maxLength={500}
                      placeholder="https://"
                      className={cn(field, 'h-11 text-[14px]')}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={label} htmlFor={`${id}-type`}>
                      {m.type}
                    </label>
                    <select
                      id={`${id}-type`}
                      name="type"
                      defaultValue=""
                      className={cn(field, 'h-11 text-[14px]')}
                    >
                      <option value="">{m.typeUnknown}</option>
                      {SERIES_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {messages.series.type[t as keyof typeof messages.series.type] ?? t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={label} htmlFor={`${id}-note`}>
                    {m.note}
                  </label>
                  <textarea
                    id={`${id}-note`}
                    name="note"
                    rows={3}
                    maxLength={1000}
                    placeholder={m.notePlaceholder}
                    className={cn(field, 'py-2 text-[14px]')}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            aria-hidden="true"
          />
          {turnstileSiteKey && !signedIn ? (
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              onToken={setToken}
              onExpire={clearToken}
              resetKey={resetKey}
            />
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className={buttonClasses('primary', 'md')}>
              {busy ? m.submitting : m.submit}
            </button>
            <Link href="/requests" onClick={onClose} className={buttonClasses('ghost', 'md')}>
              {m.seeAll}
            </Link>
          </div>
        </form>
      )}
    </Sheet>
  )
}
