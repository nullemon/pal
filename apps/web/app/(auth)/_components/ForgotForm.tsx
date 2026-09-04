'use client'

import { messages } from '@palscans/core/messages'
import { Button } from '@palscans/ui'
import { type FormEvent, useState } from 'react'
import { api, Field, Notice } from './fields'

export function ForgotForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await api<{ sent: boolean }>('/api/auth/forgot-password', { email })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setSent(true)
  }

  if (sent) return <Notice tone="ok">{messages.auth.resetSent}</Notice>

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field
        label={messages.auth.email}
        type="email"
        name="email"
        autoComplete="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? messages.common.loading : messages.authPage.forgotCta}
      </Button>
    </form>
  )
}
