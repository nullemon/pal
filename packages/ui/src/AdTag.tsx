'use client'

import { useEffect, useRef } from 'react'

/**
 * Runs one ad network's tag inside its reserved slot (docs/11).
 *
 * ## Sandboxed, because a tag that can reach the page will eventually take it
 *
 * The tag used to be injected into this document: scripts recreated as fresh elements so
 * the browser would execute them, running with the same powers as our own code. That is the
 * ordinary way to place an ad and it is also how a site gets held hostage — a network that
 * decides to serve a full-screen interstitial appends it to `document.body`, where our
 * slot's `overflow: hidden` and fixed size mean nothing, and a reader is left on a page
 * they cannot close, cannot scroll past, and cannot escape by reloading because the next
 * page does the same. We had exactly that, on phones, and the reader could not reach the
 * chapter at all.
 *
 * So the tag now runs in its own `srcdoc` frame with no `allow-same-origin`. That puts it
 * on an opaque origin: it cannot see this document, cannot append anything to it, cannot
 * read our cookies or storage, and cannot navigate us. Whatever it draws is drawn inside a
 * box we sized. An interstitial served into that frame covers the ad and nothing else,
 * which turns a site-wide outage into a bad-looking banner.
 *
 * What the frame keeps is what an ad legitimately needs: scripts, forms, and the ability to
 * open the advertiser's page on a click (`allow-popups` plus `allow-popups-to-escape-sandbox`,
 * so the landing page is not itself sandboxed). Without those the ad renders and earns
 * nothing. `allow-same-origin` is the one thing deliberately withheld, because combined
 * with `allow-scripts` on a same-origin document it hands back everything the sandbox was
 * for.
 *
 * ## The cost, stated plainly
 *
 * Formats that are *designed* to take over the page — popunders, "social bar", sticky
 * interstitials — stop working. That is the point, not a regression: those are the formats
 * that produced this bug. A network that needs top-level access for a banner is a network
 * placing something other than a banner. An operator who truly needs a top-level tag has
 * `Appearance → Advanced`, where it is their explicit decision rather than a surprise.
 *
 * Storage is the real trade: an opaque origin has none, so a network relying on
 * `localStorage` for frequency capping loses it. Ad networks handle this with cookies on
 * their own domain inside the frame, which still works.
 */

/** Everything an ad needs, and nothing that lets it reach this document. */
const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms'

/**
 * The document the frame runs.
 *
 * `<base target="_blank">` so a creative's own link opens a new tab rather than trying to
 * navigate the frame, which is what a reader expects from an ad and is also the only
 * navigation the sandbox permits. The margin reset matters because the frame is sized to
 * the creative exactly: the browser's default 8px body margin would otherwise clip it.
 */
const frameDoc = (html: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>${html}</body></html>`

export function AdTag({ slot, html }: { slot: string; html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  /**
   * The tag is written once per mount.
   *
   * Re-running a network's script on every render would re-request the slot and inflate
   * impressions — the same reason this guard existed before the frame. `srcdoc` is set
   * imperatively rather than as a prop so React re-rendering the element for an unrelated
   * reason cannot reload the frame and buy a second impression.
   */
  const written = useRef<string | null>(null)

  useEffect(() => {
    const frame = ref.current
    if (!frame || written.current === html) return
    written.current = html
    frame.srcdoc = frameDoc(html)
  }, [html])

  return (
    <iframe
      ref={ref}
      data-ad-tag={slot}
      title={slot}
      sandbox={SANDBOX}
      // `scrolling` is deprecated but still the only thing some engines honour for a frame
      // whose content overflows; the inner document sets `overflow: hidden` as well.
      scrolling="no"
      className="block size-full border-0"
    />
  )
}
