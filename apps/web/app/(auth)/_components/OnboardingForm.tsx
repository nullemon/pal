'use client'

import { messages } from '@palscans/core/messages'
import { Button } from '@palscans/ui'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { api, Field, Notice } from './fields'

export function OnboardingForm({ returnTo }: { returnTo: string }) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await api<{ return: string }>('/api/auth/onboarding', {
      username,
      return: returnTo,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    router.push(res.data.return)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field
        label={messages.auth.username}
        name="username"
        autoComplete="username"
        required
        autoFocus
        minLength={3}
        maxLength={24}
        hint={messages.authPage.usernameHint}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <Button type="submit" size="lg" disabled={busy || username.length < 3}>
        {busy ? messages.common.loading : messages.authPage.onboardingCta}
      </Button>
    </form>
  )
}
