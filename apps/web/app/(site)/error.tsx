'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button } from '@palscans/ui'
import { RotateCcw } from 'lucide-react'
import { useEffect } from 'react'

/**
 * The site's 500 page (docs/13). Before this existed a failed render — a database blip, an
 * unhandled throw in a server component — gave the reader a blank white page with no header,
 * no branding and no way out, while a mistyped URL got the carefully designed 404.
 *
 * It is inside `(site)`, so the layout supplies the header, footer and bottom nav; this file
 * renders only the panel, exactly as `not-found.tsx` does. `reset()` re-renders the failed
 * segment without a full reload, which is usually enough for a transient failure.
 */
export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The digest is all the client is given — the message and stack stay on the server, which
    // is what stops an error page leaking internals. Logging it here is what lets an operator
    // match a reader's screenshot to a line in the server log.
    console.error('render failed', error.digest ?? '(no digest)')
  }, [error])

  const m = messages.errors
  return (
    <div className="container-page pt-10 pb-12">
      <section className="mx-auto flex max-w-[560px] flex-col items-center text-center">
        <div className="font-display text-[88px] font-extrabold leading-none tracking-[-0.04em] text-brand md:text-[120px]">
          500
        </div>
        <h1 className="mt-2 font-display text-[28px] font-extrabold uppercase leading-8 tracking-[-0.02em] text-fg md:text-[34px]">
          {m.errorTitle}
        </h1>
        <p className="mt-3 max-w-[46ch] text-[15px] leading-6 text-fg-muted">{m.errorBody}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={reset} variant="primary">
            <RotateCcw size={15} aria-hidden="true" />
            {m.errorRetry}
          </Button>
          <Button href="/" variant="outline">
            {m.errorHome}
          </Button>
        </div>
        {error.digest ? (
          <p className="mt-6 font-mono text-[12px] text-fg-subtle">
            {fmt(m.errorRef, { id: error.digest })}
          </p>
        ) : null}
      </section>
    </div>
  )
}
