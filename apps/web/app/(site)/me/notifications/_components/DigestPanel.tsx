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
      {/* Real radios: arrow-key navigation and form semantics come for free, and the visual
          treatment is the same segmented control (the input itself is visually hidden). */}
      <fieldset className="inline-flex gap-0.5 self-start rounded-[10px] border border-line bg-bg p-[3px]">
        <legend className="sr-only">{m.frequency}</legend>
        {DIGEST_FREQUENCIES.map((f) => (
          <label
            key={f}
            className={cn(
              'flex h-8 cursor-pointer items-center rounded-[7px] px-3.5 text-[13px] font-semibold transition-colors',
              'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand',
              pending && 'cursor-not-allowed opacity-50',
              value === f
                ? 'bg-brand-wash text-brand-hover shadow-[inset_0_0_0_1px_var(--color-brand)]'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            <input
              type="radio"
              name="digest-frequency"
              value={f}
              checked={value === f}
              disabled={pending}
              onChange={() => pick(f)}
              className="sr-only"
            />
            {labels[f]}
          </label>
        ))}
      </fieldset>
      {value !== 'off' && !emailChannelOn ? (
        <p className="text-[12px] text-warn">{m.needsEmailChannel}</p>
      ) : null}
    </div>
  )
}
