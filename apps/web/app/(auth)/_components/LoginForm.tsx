'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button } from '@palscans/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { api, Field, Notice, PasswordField } from './fields'

interface Props {
  returnTo: string
  /** Pre-filled when the user is completing an OAuth link. */
  email?: string
  linkProvider?: string
}

type Step = 'password' | 'totp'

export function LoginForm({ returnTo, email: initialEmail = '', linkProvider }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('password')
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const finish = (target: string, linked: string | null) => {
    const url = new URL(target, window.location.origin)
    if (linked) url.searchParams.set('linked', linked)
    router.push(url.pathname + url.search + url.hash)
    router.refresh()
  }

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await api<{ mfa: boolean; return?: string; linked?: string | null }>(
      '/api/auth/login',
      {
        email,
        password,
        return: returnTo,
      },
    )
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    if (res.data.mfa) {
      setStep('totp')
      return
    }
    finish(res.data.return ?? returnTo, res.data.linked ?? null)
  }

  const submitTotp = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await api<{ return: string; linked: string | null }>('/api/auth/login/totp', {
      code,
      return: returnTo,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    finish(res.data.return, res.data.linked)
  }

  if (step === 'totp') {
    return (
      <form onSubmit={submitTotp} className="flex flex-col gap-4" noValidate>
        <div>
          <h2 className="font-display text-lg font-bold text-fg">{messages.authPage.totpTitle}</h2>
          <p className="mt-1 text-[13px] text-fg-muted">{messages.authPage.totpLead}</p>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field
          label={messages.authPage.totpCode}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
          {messages.authPage.signInCta}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={submitPassword} className="flex flex-col gap-4" noValidate>
      {linkProvider ? (
        <Notice tone="info">{fmt(messages.authPage.linkLead, { email: initialEmail })}</Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field
        label={messages.auth.email}
        type="email"
        name="email"
        autoComplete="email"
        required
        autoFocus={!initialEmail}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        readOnly={!!linkProvider}
      />
      <PasswordField
        label={messages.auth.password}
        name="password"
        autoComplete="current-password"
        required
        autoFocus={!!initialEmail}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        trailing={
          <Link
            href="/forgot-password"
            className="text-[12px] font-semibold text-brand-hover hover:underline"
          >
            {messages.auth.forgotPassword}
          </Link>
        }
      />
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? messages.common.loading : messages.authPage.signInCta}
      </Button>
    </form>
  )
}
