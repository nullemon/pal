'use client'

import { useEffect } from 'react'

/**
 * Reports one page view to POST /api/views (docs/02 "Views and ranking").
 *
 * Deliberately not a server-side counter. A view is reported only when a real browser has
 * had the page open and visible for `DWELL_MS`, which drops three kinds of non-view for
 * free: Next's route prefetches (they fetch data, they never mount this), speculation-rules
 * prerenders (hidden until activated), and the reader who lands on the wrong chapter and
 * leaves immediately.
 *
 * `sessionStorage` keeps a refresh within the same tab from even sending the beacon; the
 * server dedupes properly (per viewer, per chapter, per UTC day) and does not trust this.
 */
const DWELL_MS = 1_500

export interface ViewBeaconProps {
  seriesId: number
  /** Omit (or 0) for a series-page view. */
  chapterId?: number
}

export function ViewBeacon({ seriesId, chapterId = 0 }: ViewBeaconProps) {
  useEffect(() => {
    const mark = `pv:${seriesId}:${chapterId}`
    try {
      if (sessionStorage.getItem(mark)) return
    } catch {
      // private mode or storage disabled: fall through, the server still dedupes
    }

    let timer: number | null = null
    const send = () => {
      timer = null
      try {
        sessionStorage.setItem(mark, '1')
      } catch {
        /* ignore */
      }
      const body = JSON.stringify({ seriesId, chapterId })
      if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon('/api/views', new Blob([body], { type: 'application/json' }))
        return
      }
      void fetch('/api/views', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined)
    }

    const start = () => {
      if (timer !== null) return
      timer = window.setTimeout(send, DWELL_MS)
    }
    const stop = () => {
      if (timer === null) return
      window.clearTimeout(timer)
      timer = null
    }
    // A prerendered page is not being read yet; the clock starts when it is shown.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [seriesId, chapterId])

  return null
}
