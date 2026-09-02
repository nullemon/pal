'use client'

import { messages } from '@palscans/core/messages'
import { Button } from '@palscans/ui'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { api, Field, Notice, PasswordField } from './fields'

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_]{1,22})[a-z0-9]$/i

/** docs/17 §C: the invite field appears only while registration is invite only. */
export function RegisterForm({
  returnTo,
  inviteRequired = false,
  initialInvite = '',
}: {
  returnTo: string
  inviteRequired?: boolean
  initialInvite?: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState(initialInvite)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({})
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: typeof fieldErrors = {}
    if (username && !USERNAME_RE.test(username)) next.username = messages.authPage.usernameHint
    if (password.length < 10) next.password = messages.auth.weakPassword
    setFieldErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    setError(null)
    const res = await api<{ return: string }>('/api/auth/register', {
      email,
      password,
      username: username || undefined,
      return: returnTo,
      invite: invite.trim() || undefined,
    })
    setBusy(false)
    if (!res.ok) {
      if (res.error === 'username_taken' || res.error === 'username_reserved')
        setFieldErrors({ username: res.message })
      else if (res.error === 'breached_password') setFieldErrors({ password: res.message })
      else setError(res.message)
      return
    }
    router.push(res.data.return)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
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
      <Field
        label={messages.auth.username}
        name="username"
        autoComplete="username"
        minLength={3}
        maxLength={24}
        hint={messages.authPage.usernameHint}
        error={fieldErrors.username}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      {inviteRequired ? (
        <Field
          label={messages.auth.inviteCode}
          name="invite"
          autoComplete="off"
          required
          maxLength={32}
          hint={messages.auth.inviteCodeHint}
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
        />
      ) : null}
      <PasswordField
        label={messages.auth.password}
        name="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint={messages.authPage.passwordHint}
        error={fieldErrors.password}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? messages.common.loading : messages.authPage.registerCta}
      </Button>
      <p className="text-[12px] text-fg-subtle">{messages.authPage.legal}</p>
    </form>
  )
}
