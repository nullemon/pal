'use client'

import { messages } from '@palscans/core/messages'
import { Button } from '@palscans/ui'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { api, Notice } from './fields'

type State = 'checking' | 'ok' | 'invalid'

/** Consumes the link's token with a POST (mail scanners only follow GETs, so the link survives them). */
export function VerifyPanel({ token, returnTo }: { token: string; returnTo: string }) {
  const [state, setState] = useState<State>('checking')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    api<{ verified: boolean }>('/api/auth/verify', { token }).then((res) =>
      setState(res.ok ? 'ok' : 'invalid'),
    )
  }, [token])

  if (state === 'checking') return <Notice tone="info">{messages.authPage.verifyChecking}</Notice>
  if (state === 'invalid')
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="error">{messages.authPage.verifyInvalid}</Notice>
        <ResendButton />
      </div>
    )
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="ok">{messages.auth.verified}</Notice>
      <Button href={returnTo} size="lg">
        {messages.common.ok}
      </Button>
    </div>
  )
}

export function ResendButton() {
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const resend = async () => {
    const res = await api<{ sent: boolean; alreadyVerified?: boolean }>(
      '/api/auth/resend-verification',
    )
    if (!res.ok) {
      setState('error')
      setMessage(res.status === 401 ? messages.errors.unauthorized : res.message)
      return
    }
    setState('sent')
    setMessage(res.data.alreadyVerified ? messages.auth.verified : messages.authPage.verifyResent)
  }
  return (
    <div className="flex flex-col gap-3">
      {message ? <Notice tone={state === 'error' ? 'error' : 'ok'}>{message}</Notice> : null}
      {state !== 'sent' ? (
        <Button variant="outline" size="lg" onClick={resend}>
          {messages.authPage.verifyResend}
        </Button>
      ) : null}
      {state === 'error' ? (
        <Link
          href="/login?return=%2Fverify"
          className="text-center text-[13px] font-semibold text-brand-hover hover:underline"
        >
          {messages.auth.signIn}
        </Link>
      ) : null}
    </div>
  )
}
