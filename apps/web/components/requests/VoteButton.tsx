'use client'

import { fmt, messages } from '@palscans/core/messages'
import { cn, useToast } from '@palscans/ui'
import { ChevronUp } from 'lucide-react'
import { useState, useTransition } from 'react'
import { postVote } from './api'

const m = messages.requests

export interface VoteButtonProps {
  id: number
  title: string
  voteCount: number
  voted: boolean
  /** Told about every change so the list can re-sort or a parent can keep its own copy. */
  onChange?: (next: { voted: boolean; voteCount: number }) => void
  size?: 'sm' | 'md'
}

/**
 * One upvote. Optimistic, because the answer is a single row and the interesting failures
 * (rate limited, no identity) come back fast enough to undo — and because a counter that
 * waits for a round trip before it moves feels broken.
 *
 * The server is still the only thing that decides: it answers with the authoritative count
 * from `series_requests.vote_count`, and that is what ends up rendered.
 */
export function VoteButton({
  id,
  title,
  voteCount,
  voted,
  onChange,
  size = 'md',
}: VoteButtonProps) {
  const { toast } = useToast()
  const [state, setState] = useState({ voted, voteCount })
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  const toggle = () => {
    if (busy) return
    const next = {
      voted: !state.voted,
      voteCount: Math.max(0, state.voteCount + (state.voted ? -1 : 1)),
    }
    const previous = state
    setState(next)
    onChange?.(next)
    setBusy(true)
    startTransition(async () => {
      const res = await postVote(id, next.voted)
      setBusy(false)
      if (!res.ok) {
        setState(previous)
        onChange?.(previous)
        toast({
          title: res.status === 429 ? m.voteRateLimited : res.message || m.failed,
          tone: 'danger',
        })
        return
      }
      const confirmed = { voted: res.data.voted, voteCount: res.data.voteCount }
      setState(confirmed)
      onChange?.(confirmed)
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending && busy}
      aria-pressed={state.voted}
      aria-label={fmt(state.voted ? m.unvoteAria : m.voteAria, { title })}
      className={cn(
        'group flex shrink-0 flex-col items-center justify-center rounded-[10px] border transition-colors',
        size === 'sm' ? 'h-11 w-11' : 'h-14 w-14',
        state.voted
          ? 'border-brand bg-brand-wash text-brand-hover'
          : 'border-line bg-surface-1 text-fg-muted hover:border-brand hover:text-fg',
      )}
    >
      <ChevronUp size={size === 'sm' ? 14 : 16} aria-hidden="true" />
      <span
        className={cn(
          'font-bold tabular-nums leading-none',
          size === 'sm' ? 'text-[12px]' : 'text-[14px]',
        )}
      >
        {state.voteCount}
      </span>
    </button>
  )
}
