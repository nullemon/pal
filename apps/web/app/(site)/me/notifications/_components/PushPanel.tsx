'use client'

import { messages } from '@palscans/core/messages'
import { Button, cn, useToast } from '@palscans/ui'
import { BellOff, BellRing, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

/**
 * Web push, from the reader's side (docs/17 §D).
 *
 * A subscription belongs to *this browser on this device*, not to the account, so the panel
 * reports what the browser holds rather than what the database holds — the number of other
 * devices comes from the server and is shown alongside. Everything degrades: no service
 * worker, no `PushManager`, a denied permission or an insecure origin each produce a plain
 * sentence instead of a dead button.
 */
type State = 'loading' | 'unsupported' | 'insecure' | 'denied' | 'off' | 'on'

const post = async (url: string, body?: unknown) => {
  const res = await fetch(url, {
    method: body === undefined ? 'POST' : 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const json = (await res.json().catch(() => ({}))) as { data?: unknown; message?: string }
  return { ok: res.ok, message: json.message, data: json.data }
}

/** VAPID keys travel as base64url; `PushManager` wants raw bytes. */
const urlBase64ToUint8Array = (base64: string): Uint8Array<ArrayBuffer> => {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = window.atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

export function PushPanel({
  publicKey,
  otherDevices,
}: {
  publicKey: string
  otherDevices: number
}) {
  const m = messages.notify.push
  const { toast } = useToast()
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)
  const [endpoint, setEndpoint] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const detect = async () => {
      if (typeof window === 'undefined') return
      if (!window.isSecureContext) return setState('insecure')
      if (!('serviceWorker' in navigator) || !('PushManager' in window))
        return setState('unsupported')
      if (Notification.permission === 'denied') return setState('denied')
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        })
        const sub = await registration.pushManager.getSubscription()
        if (cancelled) return
        setEndpoint(sub?.endpoint ?? null)
        setState(sub ? 'on' : 'off')
      } catch {
        if (!cancelled) setState('unsupported')
      }
    }
    void detect()
    return () => {
      cancelled = true
    }
  }, [])

  const subscribe = useCallback(async () => {
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      const body = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> }
      const res = await post('/api/push/subscribe', body)
      if (!res.ok) {
        await sub.unsubscribe().catch(() => undefined)
        toast({ title: res.message ?? m.failed, tone: 'danger' })
        setState('off')
        return
      }
      setEndpoint(sub.endpoint)
      setState('on')
      toast({ title: m.subscribed, tone: 'ok' })
    } catch {
      toast({ title: m.failed, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }, [publicKey, toast, m])

  const unsubscribe = useCallback(async () => {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.getSubscription()
      const dead = sub?.endpoint ?? endpoint
      if (sub) await sub.unsubscribe()
      if (dead)
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: dead }),
        })
      setEndpoint(null)
      setState('off')
      toast({ title: m.unsubscribed })
    } catch {
      toast({ title: m.failed, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }, [endpoint, toast, m])

  const sendTest = useCallback(async () => {
    setBusy(true)
    const res = await post('/api/push/test')
    setBusy(false)
    toast({ title: res.message ?? m.failed, tone: res.ok ? 'ok' : 'danger' })
  }, [toast, m])

  const notice =
    state === 'unsupported'
      ? m.unsupported
      : state === 'insecure'
        ? m.insecure
        : state === 'denied'
          ? m.denied
          : null

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[62ch] text-[13px] text-fg-muted">{messages.notify.push.description}</p>
      {notice ? (
        <p className="rounded-md border border-line bg-surface-2 p-3 text-[13px] text-fg-muted">
          {notice}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold',
              state === 'on' ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-fg-muted',
            )}
          >
            {state === 'on' ? <BellRing size={13} /> : <BellOff size={13} />}
            {state === 'on' ? m.enabled : m.disabled}
          </span>
          <Button
            size="sm"
            variant={state === 'on' ? 'outline' : 'primary'}
            disabled={busy || state === 'loading'}
            onClick={() => void (state === 'on' ? unsubscribe() : subscribe())}
          >
            {state === 'on' ? m.disable : m.enable}
          </Button>
          {state === 'on' ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void sendTest()}>
              <Send size={13} aria-hidden="true" />
              {m.test}
            </Button>
          ) : null}
        </div>
      )}
      <p className="text-[12px] text-fg-subtle">
        {otherDevices > 0 ? m.enabledOn.replace('{n}', String(otherDevices)) : m.noDevices}
      </p>
    </div>
  )
}
