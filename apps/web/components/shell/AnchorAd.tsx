'use client'

import { messages } from '@palscans/core/messages'
import { AdSlot } from '@palscans/ui'
import { useEffect, useState } from 'react'

/**
 * `mobile_anchor` — the sticky bar across the bottom of the window.
 *
 * Despite the slot's name it runs on both sizes: 320x50 on a phone, 728x90 from `md` up.
 * The name is the settings key an operator has already pasted a tag into, so renaming it
 * would silently drop that tag on the floor; the admin screen says what it actually does.
 *
 * ## It takes space instead of covering it
 *
 * The bar is `position: fixed`, so on its own it would sit on top of whatever the page has
 * at the bottom edge -- the mobile tab bar, and in the reader the chapter nav. Mounting it
 * sets `data-anchor` on `<html>`, which gives `--anchor-h` the bar's height (globals.css),
 * and the three things that reach the bottom edge subtract it: the site layout's `main`
 * padding, `BottomNavBar`, and the reader overlay's own `bottom`. So the reader simply ends
 * above the ad rather than fighting it, and nothing is ever hidden behind the bar.
 *
 * ## It can be closed
 *
 * An anchor with no way out is the placement readers hate and the one networks and Google's
 * Better Ads rules single out. Closing is remembered for the tab rather than forever:
 * `sessionStorage`, so a reader who dismisses it is left alone for the visit and the slot is
 * still worth something on the next one. The read happens in an effect because the server
 * cannot know what the tab remembers, and rendering the bar and then removing it is the only
 * version that does not risk a hydration mismatch.
 */

const DISMISSED = 'pal.anchor-ad.dismissed'

export interface AnchorAdProps {
  /** The network's tag from `Admin -> Business -> Ads`. Nothing renders without one. */
  tag: string | null
  /** False when the slot is off or this viewer is ad-free. */
  show: boolean
  /** Force the dashed outline, for the ads screen's placement preview. */
  placeholder?: boolean
}

export function AnchorAd({ tag, show, placeholder = false }: AnchorAdProps) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISSED) === '1') setDismissed(true)
    } catch {
      // Private mode, or storage blocked. The bar stays -- it is the ad that pays, and a
      // reader who cannot persist a dismissal can still press the button again.
    }
  }, [])

  const live = show && (Boolean(tag) || placeholder) && !dismissed

  useEffect(() => {
    const root = document.documentElement
    if (!live) {
      root.removeAttribute('data-anchor')
      return
    }
    root.setAttribute('data-anchor', 'on')
    // On unmount as well as on dismissal: navigating from a page that has the bar to one
    // that does not must give the space back, or every page below it keeps a dead gap.
    return () => root.removeAttribute('data-anchor')
  }, [live])

  if (!live) return null

  return (
    <aside
      aria-label={messages.ads.label}
      className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--anchor-h)] items-center justify-center border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-[14px]"
    >
      <AdSlot
        slot="mobile_anchor"
        width={320}
        height={50}
        desktopWidth={728}
        desktopHeight={90}
        label={messages.ads.anchor}
        placeholder={placeholder}
        tag={tag}
      />
      <button
        type="button"
        onClick={() => {
          setDismissed(true)
          try {
            sessionStorage.setItem(DISMISSED, '1')
          } catch {
            // Nothing to do: the bar is gone for this page either way.
          }
        }}
        aria-label={messages.ads.closeAnchor}
        title={messages.ads.closeAnchor}
        className="absolute right-2 top-1 flex size-7 items-center justify-center rounded-full border border-line bg-surface-2/90 text-fg-muted transition-colors hover:text-fg"
      >
        <span aria-hidden="true" className="text-[13px] leading-none">
          ✕
        </span>
      </button>
    </aside>
  )
}
