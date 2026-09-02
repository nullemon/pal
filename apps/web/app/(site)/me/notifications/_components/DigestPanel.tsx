'use client'

import { messages } from '@palscans/core/messages'
import { cn, useToast } from '@palscans/ui'
import { useState, useTransition } from 'react'
import { DIGEST_FREQUENCIES, type DigestFrequency } from '@/lib/notifications/schema'
import { saveDigestFrequency } from '../actions'

/**
 * The email digest opt-in (docs/17 §D). Three states, saved the moment they are picked —
 * there is nothing else on this panel to batch a save with.
 *
 * The digest is *also* gated by the `New chapter × Email` cell of the matrix below, because
 * that is the preference every sender consults; the hint says so rather than letting the two
 * controls disagree silently.
 */
export function DigestPanel({
  initial,
  emailChannelOn,
}: {
  initial: DigestFrequency
  emailChannelOn: boolean
}) {
  const m = messages.notify.digest
  const { toast } = useToast()
  const [value, setValue] = useState<DigestFrequency>(initial)
  const [pending, startTransition] = useTransition()
  const labels: Record<DigestFrequency, string> = { off: m.off, daily: m.daily, weekly: m.weekly }

  const pick = (next: DigestFrequency) => {
    const previous = value
    setValue(next)
    startTransition(async () => {
      const res = await saveDigestFrequency(next)
      if (!res.ok) setValue(previous)
      toast({ title: res.message, tone: res.ok ? 'ok' : 'danger' })
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[62ch] text-[13px] text-fg-muted">{m.description}</p>
      <div
        role="radiogroup"
        aria-label={m.frequency}
        className="inline-flex gap-0.5 self-start rounded-[10px] border border-line bg-bg p-[3px]"
      >
        {DIGEST_FREQUENCIES.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={value === f}
            disabled={pending}
            onClick={() => pick(f)}
            className={cn(
              'h-8 rounded-[7px] px-3.5 text-[13px] font-semibold transition-colors disabled:opacity-50',
              value === f
                ? 'bg-brand-wash text-brand-hover shadow-[inset_0_0_0_1px_var(--color-brand)]'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {labels[f]}
          </button>
        ))}
      </div>
      {value !== 'off' && !emailChannelOn ? (
        <p className="text-[12px] text-warn">{m.needsEmailChannel}</p>
      ) : null}
    </div>
  )
}
