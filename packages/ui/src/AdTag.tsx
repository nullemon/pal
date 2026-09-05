'use client'

import { useEffect, useRef } from 'react'

/**
 * Runs one ad network's tag inside its reserved slot (docs/11).
 *
 * Ad tags are markup plus one or more `<script>` elements. Assigning them through
 * `innerHTML` inserts the scripts but never executes them — the HTML spec disables that
 * exact case — so each script is recreated as a fresh element with its attributes copied
 * across. That is what makes the tag actually run, and it is why this is a client island
 * rather than `dangerouslySetInnerHTML` on the server.
 *
 * The tag is operator-supplied, staff-only, and validated nowhere on purpose: an ad tag *is*
 * arbitrary third-party script, and pretending to sanitise it would be theatre. What is
 * guaranteed is that it never renders for a reader holding `no_ads` (`AdSlot` returns null
 * before reaching here) and never for a slot the operator has switched off.
 */
export function AdTag({ slot, html }: { slot: string; html: string }) {
  const ref = useRef<HTMLDivElement>(null)
  // The tag runs once per mount. Re-running a network's script on every render would
  // re-request the slot and inflate impressions.
  const ran = useRef<string | null>(null)

  useEffect(() => {
    const host = ref.current
    if (!host || ran.current === html) return
    ran.current = html
    host.replaceChildren()

    const template = document.createElement('template')
    template.innerHTML = html
    const fragment = template.content

    // Re-create every script so the browser executes it.
    for (const old of Array.from(fragment.querySelectorAll('script'))) {
      const script = document.createElement('script')
      for (const { name, value } of Array.from(old.attributes)) script.setAttribute(name, value)
      script.text = old.textContent ?? ''
      old.replaceWith(script)
    }
    host.appendChild(fragment)
  }, [html])

  return <div ref={ref} data-ad-tag={slot} className="contents" />
}
