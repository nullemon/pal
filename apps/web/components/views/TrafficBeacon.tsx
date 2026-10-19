'use client'

import { useEffect } from 'react'

/**
 * Reports once per browser session where this visit came from (docs/13).
 *
 * In the site layout rather than on the chapter page, because a link posted on X lands
 * wherever it was pointed — the home page, a series, a chapter — and a counter that only
 * sees chapter pages would under-count exactly the campaigns worth measuring.
 *
 * What it sends is the referrer the browser already revealed on the navigation and the
 * `?ref=` tag from the URL. Nothing else: no id, no page, no time beyond the day the server
 * stamps. The session flag also makes this one request per visit rather than one per page.
 *
 * It also remembers the first source in `sessionStorage` so a sign-up later in the same
 * visit can be attributed to it. That stays in the visitor's own browser until they choose
 * to create an account.
 */
export const TRAFFIC_MARK = 'pal:src'

export function TrafficBeacon() {
  useEffect(() => {
    let already = false
    try {
      already = sessionStorage.getItem(TRAFFIC_MARK) !== null
    } catch {
      // private mode: send anyway, the worst case is one extra count in a session
    }

    const ref = new URLSearchParams(window.location.search).get('ref') ?? ''
    const referrer = document.referrer || ''
    if (!already) {
      try {
        sessionStorage.setItem(TRAFFIC_MARK, JSON.stringify({ referrer, ref }))
      } catch {
        /* ignore */
      }
      const body = JSON.stringify({ referrer, ref })
      if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon('/api/traffic', new Blob([body], { type: 'application/json' }))
      } else {
        void fetch('/api/traffic', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {})
      }
    }
  }, [])

  return null
}
