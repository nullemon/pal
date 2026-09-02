'use client'

import { useEffect, useRef } from 'react'

/**
 * Cloudflare Turnstile in invisible ("interaction-only") mode for the comment composer
 * (docs/14 §2 step 3). The script is loaded once, on demand; the token reaches the parent
 * through `onToken` and is cleared on expiry so a stale one is never submitted.
 */
interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string
  reset(id?: string): void
  remove(id: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading: Promise<void> | null = null

const loadScript = (): Promise<void> => {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      loading = null
      reject(new Error('turnstile script failed'))
    }
    document.head.appendChild(s)
  })
  return loading
}

export interface TurnstileWidgetProps {
  siteKey: string
  onToken: (token: string) => void
  onExpire: () => void
  /** Bump to reset the widget (after a submit, tokens are single-use). */
  resetKey: number
}

export function TurnstileWidget({ siteKey, onToken, onExpire, resetKey }: TurnstileWidgetProps) {
  const ref = useRef<HTMLDivElement>(null)
  const idRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  const onExpireRef = useRef(onExpire)
  onTokenRef.current = onToken
  onExpireRef.current = onExpire

  useEffect(() => {
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return
        idRef.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          appearance: 'interaction-only',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onExpireRef.current(),
          'error-callback': () => onExpireRef.current(),
          'timeout-callback': () => onExpireRef.current(),
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      if (idRef.current && window.turnstile) window.turnstile.remove(idRef.current)
      idRef.current = null
    }
  }, [siteKey])

  useEffect(() => {
    if (resetKey > 0 && idRef.current && window.turnstile) window.turnstile.reset(idRef.current)
  }, [resetKey])

  return <div ref={ref} className="mt-2 empty:hidden" />
}
