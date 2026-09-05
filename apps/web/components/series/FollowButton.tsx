'use client'

import { messages } from '@palscans/core/messages'
import { cn, useToast } from '@palscans/ui'
import { Bell, BellOff, BellRing, Check, ChevronDown, Mail, Monitor } from 'lucide-react'
import type { ComponentType } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { del, putJson } from '@/lib/comments/client'
import { FOLLOW_MODES, type FollowMode } from '@/lib/notifications/follow-modes'

/**
 * The follow control (docs/17 §D) — "tell me when this updates", which is **not** the
 * bookmark beside it. The button toggles the follow; the caret opens the per-series
 * settings, so the common case is one tap and the reader who wants a quieter channel for
 * one of their forty series can have it without leaving the page.
 *
 * `source: 'bookmark'` is a follow the reader never wrote: they bookmarked before follows
 * existed and are still being notified. It is shown as *on*, because it is, and the panel
 * says where it came from — anything else would be a screen that lies about what will
 * happen when the next chapter goes up.
 */
export interface FollowInitialState {
  following: boolean
  mode: FollowMode
  source: 'follow' | 'bookmark' | null
}

export interface FollowButtonProps {
  seriesId: number
  seriesSlug: string
  signedIn: boolean
  initial: FollowInitialState
  /** `compact` is the reader's end-of-chapter strip; `full` is the series header. */
  variant?: 'full' | 'compact'
  className?: string
}

const MODE_ICON: Record<FollowMode, ComponentType<{ size?: number; className?: string }>> = {
  all: BellRing,
  push: Bell,
  in_app: Monitor,
  digest: Mail,
  off: BellOff,
}

const base =
  'inline-flex items-center gap-2 rounded-[12px] border border-line bg-transparent font-semibold text-fg transition-colors hover:border-brand hover:bg-brand-wash disabled:opacity-60'

const signInHref = (slug: string) => `/login?next=${encodeURIComponent(`/series/${slug}`)}`

export function FollowButton({
  seriesId,
  seriesSlug,
  signedIn,
  initial,
  variant = 'full',
  className,
}: FollowButtonProps) {
  const m = messages.follows
  const { toast } = useToast()
  const [state, setState] = useState<FollowInitialState>(initial)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const size = variant === 'compact' ? 'h-9 px-3 text-[13px]' : 'h-11 px-4 text-sm'

  if (!signedIn)
    return (
      <a href={signInHref(seriesSlug)} className={cn(base, size, className)}>
        <Bell size={variant === 'compact' ? 15 : 18} aria-hidden="true" />
        {m.follow}
      </a>
    )

  const apply = async (next: FollowMode | null) => {
    const previous = state
    setBusy(true)
    setState(
      next === null
        ? { following: false, mode: 'off', source: null }
        : { following: next !== 'off', mode: next, source: 'follow' },
    )
    const res =
      next === null
        ? await del<{ following: boolean; mode: FollowMode | null; message: string }>(
            `/api/follows/${seriesId}`,
          )
        : await putJson<{ following: boolean; mode: FollowMode; message: string }>(
            `/api/follows/${seriesId}`,
            { mode: next },
          )
    setBusy(false)
    if (!res.ok) {
      setState(previous)
      toast({ title: res.message || messages.errors.generic, tone: 'danger' })
      return
    }
    setState({
      following: res.data.following,
      mode: res.data.mode ?? 'off',
      source: res.data.mode === null ? null : 'follow',
    })
    toast({ title: res.data.message, tone: 'ok' })
  }

  const on = state.following
  const Icon = MODE_ICON[on ? state.mode : 'off']

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div className="inline-flex">
        <button
          type="button"
          aria-pressed={on}
          disabled={busy}
          onClick={() => void apply(on ? null : 'all')}
          className={cn(
            base,
            size,
            'rounded-r-none border-r-0',
            on && 'border-brand/60 bg-brand-wash text-brand-hover',
          )}
        >
          <Icon size={variant === 'compact' ? 15 : 18} aria-hidden="true" />
          {on ? m.following : m.follow}
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={m.settingsTitle}
          disabled={busy}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            base,
            variant === 'compact' ? 'h-9 px-2' : 'h-11 px-2.5',
            'rounded-l-none',
            on && 'border-brand/60 bg-brand-wash text-brand-hover',
          )}
        >
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
      {open ? (
        <div
          id={panelId}
          className="absolute left-0 top-full z-30 mt-2 w-[290px] rounded-[12px] border border-line bg-surface-2 p-2 shadow-2"
        >
          <div className="px-2 pb-1 pt-1 text-sm font-semibold">{m.settingsTitle}</div>
          <p className="px-2 pb-2 text-[12px] text-fg-muted">{m.followHint}</p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {FOLLOW_MODES.map((mode) => {
              const ModeIcon = MODE_ICON[mode]
              const active = on ? state.mode === mode : mode === 'off'
              return (
                <li key={mode}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void apply(mode)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-surface-3',
                      active && 'bg-brand-wash',
                    )}
                  >
                    <ModeIcon
                      size={14}
                      className={cn(
                        'mt-[3px] shrink-0',
                        active ? 'text-brand-hover' : 'text-fg-subtle',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block text-[13px] font-semibold',
                          active ? 'text-brand-hover' : 'text-fg',
                        )}
                      >
                        {m.modes[mode]}
                      </span>
                      <span className="block text-[11px] leading-4 text-fg-muted">
                        {m.modeHints[mode]}
                      </span>
                    </span>
                    {active ? (
                      <Check
                        size={14}
                        className="mt-[3px] shrink-0 text-brand-hover"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
          {state.source === 'bookmark' ? (
            <p className="mt-1 border-t border-line-soft px-2 pt-2 text-[11px] text-fg-muted">
              {m.viaBookmarkHint}
            </p>
          ) : null}
          {on ? (
            <div className="mt-1 border-t border-line-soft px-2 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void apply(null)}
                className="font-semibold text-[12px] text-danger hover:underline"
              >
                {m.unfollow}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
