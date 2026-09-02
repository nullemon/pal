'use client'

import { messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import { Angry, Frown, Heart, Laugh, SmilePlus, Sparkles, ThumbsUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { REACTION_KINDS, type ReactionKind } from '@/lib/comments/types'

const ICONS: Record<ReactionKind, typeof ThumbsUp> = {
  up: ThumbsUp,
  funny: Laugh,
  love: Heart,
  surprised: Sparkles,
  angry: Angry,
  sad: Frown,
}

export interface ReactionBarProps {
  counts: Partial<Record<ReactionKind, number>>
  mine: readonly ReactionKind[]
  onToggle: (kind: ReactionKind) => void
  disabled?: boolean
  size?: 'md' | 'sm'
  /** Premium/staff can open the reactor list (docs/14 "Premium perks"). */
  onSeeReactors?: () => void
}

const pill =
  'inline-flex items-center gap-[5px] rounded-full border px-2 text-[12px] font-semibold transition-colors duration-[120ms] disabled:opacity-60'

/** Six reactions, one of each per user; tapping your own removes it (docs/14 §1). */
export function ReactionBar({
  counts,
  mine,
  onToggle,
  disabled,
  size = 'md',
  onSeeReactors,
}: ReactionBarProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const h = size === 'sm' ? 'h-[22px]' : 'h-6'

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const shown = REACTION_KINDS.filter((k) => (counts[k] ?? 0) > 0 || mine.includes(k))
  const visible = shown.length ? shown : (['up'] as const)

  return (
    <div ref={ref} className="relative flex flex-wrap items-center gap-1.5">
      {visible.map((k) => {
        const Icon = ICONS[k]
        const active = mine.includes(k)
        const n = counts[k] ?? 0
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            title={messages.comments.reactions[k]}
            onClick={() => onToggle(k)}
            className={cn(
              pill,
              h,
              active
                ? 'border-brand/55 bg-brand-wash text-brand-hover'
                : 'border-line text-fg-muted hover:border-brand hover:text-fg',
            )}
          >
            <Icon size={13} aria-hidden="true" />
            {n > 0 ? <span className="tabular-nums">{n}</span> : null}
            <span className="sr-only">{messages.comments.reactions[k]}</span>
          </button>
        )
      })}
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-label={messages.commentThread.more}
        onClick={() => setOpen((o) => !o)}
        className={cn(pill, h, 'border-line px-1.5 text-fg-muted hover:border-brand hover:text-fg')}
      >
        <SmilePlus size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 flex items-center gap-1 rounded-[10px] border border-line bg-surface-2 p-1 shadow-2"
        >
          {REACTION_KINDS.map((k) => {
            const Icon = ICONS[k]
            const active = mine.includes(k)
            return (
              <button
                key={k}
                type="button"
                role="menuitemcheckbox"
                aria-checked={active}
                title={messages.comments.reactions[k]}
                onClick={() => {
                  onToggle(k)
                  setOpen(false)
                }}
                className={cn(
                  'inline-flex size-9 items-center justify-center rounded-md transition-colors',
                  active
                    ? 'bg-brand-wash text-brand-hover'
                    : 'text-fg-muted hover:bg-surface-3 hover:text-fg',
                )}
              >
                <Icon size={16} aria-hidden="true" />
                <span className="sr-only">{messages.comments.reactions[k]}</span>
              </button>
            )
          })}
          {onSeeReactors ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSeeReactors()
                setOpen(false)
              }}
              className="ml-1 whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-semibold text-fg-muted hover:bg-surface-3 hover:text-fg"
            >
              {messages.commentThread.whoReacted}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
