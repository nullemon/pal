'use client'

import { messages } from '@palscans/core/messages'
import { Button } from '@palscans/ui'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { api, Notice, PasswordField } from './fields'

export function ResetForm({ token }: { token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 10) {
      setError(messages.auth.weakPassword)
      return
    }
    if (password !== confirm) {
      setError(messages.errors.validation)
      return
    }
    setBusy(true)
    setError(null)
    const res = await api<{ reset: boolean }>('/api/auth/reset-password', { token, password })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    router.push('/login?reset=1')
  }

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <PasswordField
        label={messages.auth.password}
        name="password"
        autoComplete="new-password"
        required
        minLength={10}
        autoFocus
        hint={messages.authPage.passwordHint}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <PasswordField
        label={messages.auth.confirmPassword}
        name="confirm"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? messages.common.loading : messages.authPage.resetCta}
      </Button>
    </form>
  )
}
