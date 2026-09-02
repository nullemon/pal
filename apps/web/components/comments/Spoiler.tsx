'use client'

import { messages } from '@palscans/core/messages'
import { EyeOff } from 'lucide-react'
import { type ReactNode, useState } from 'react'

/** Blurred until tapped (docs/14 §1 composer). Reveal is per element, not per comment. */
export function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false)
  if (shown)
    return (
      <button
        type="button"
        onClick={() => setShown(false)}
        title={messages.commentThread.spoilerHide}
        className="rounded-sm bg-surface-3 px-1 text-fg"
      >
        {children}
      </button>
    )
  return (
    <button
      type="button"
      onClick={() => setShown(true)}
      className="inline-flex h-5 items-center gap-1.5 rounded-full border border-line bg-fg-muted/10 px-2 align-[-5px] text-[12px] font-semibold text-fg-muted [text-shadow:0_0_6px_var(--color-fg-muted)] hover:border-brand hover:text-fg"
    >
      <EyeOff size={12} aria-hidden="true" />
      {messages.commentThread.spoilerReveal}
    </button>
  )
}
