'use client'

import { messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { RequestModal } from './RequestModal'

const m = messages.requests

interface Config {
  turnstileSiteKey: string | null
  signedIn: boolean
}

/**
 * The header control. It opens the modal where the reader is, rather than navigating: a
 * reader forty chapters into something should not have to lose their place to ask for a
 * title, and a request board nobody can reach from the page they are on is a board nobody
 * uses.
 *
 * The modal is mounted lazily — the first click is what loads it, its configuration and the
 * Turnstile script — so a header on every page costs nothing until somebody presses it.
 *
 * Accessibility is `Sheet`'s: a native `<dialog>` opened with `showModal()`, which traps
 * focus, closes on Escape, and returns focus to this button when it closes. All this adds is
 * the accessible name (visible text above `lg`, `aria-label` always) and `aria-haspopup`.
 */
export function RequestTrigger({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [config, setConfig] = useState<Config>({ turnstileSiteKey: null, signedIn: false })

  useEffect(() => {
    if (!mounted) return
    let cancelled = false
    fetch('/api/requests/config', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j: { data?: Config }) => {
        if (!cancelled && j.data) setConfig(j.data)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [mounted])

  return (
    <>
      <button
        type="button"
        aria-label={m.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setMounted(true)
          setOpen(true)
        }}
        className={cn(
          'inline-flex h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-surface-1 px-2.5 text-fg-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-fg lg:px-3',
          className,
        )}
      >
        <Sparkles size={16} aria-hidden="true" />
        <span className="hidden text-sm font-medium lg:inline">{m.trigger}</span>
      </button>
      {mounted ? (
        <RequestModal
          open={open}
          onClose={() => setOpen(false)}
          turnstileSiteKey={config.turnstileSiteKey}
          signedIn={config.signedIn}
        />
      ) : null}
    </>
  )
}
