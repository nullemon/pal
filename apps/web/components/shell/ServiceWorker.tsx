'use client'

import { useEffect } from 'react'

/**
 * Registers `/sw.js` (docs/06 "Mobile specifics": the PWA needs a service worker with a
 * fetch handler to be installable at all, and offline downloads need one to serve cached
 * pages back).
 *
 * Registration waits for `load` so it never competes with the reader's first image, and it
 * is deliberately quiet: a browser that refuses — private mode, an insecure origin, a policy
 * — leaves the site working exactly as before, just without downloads.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
    }
    if (document.readyState === 'complete') {
      register()
      return
    }
    window.addEventListener('load', register, { once: true })
    return () => window.removeEventListener('load', register)
  }, [])
  return null
}
