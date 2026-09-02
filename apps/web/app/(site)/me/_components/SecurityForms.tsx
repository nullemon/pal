'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, cn, RelativeTime, useToast } from '@palscans/ui'
import { Monitor, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useState } from 'react'
import { api, inputClasses, labelClasses } from './api'

export interface SessionRow {
  id: string
  browser: string
  os: string
  createdAt: string
  lastSeenAt: string | null
  current: boolean
}

export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const revoke = async (id: string) => {
    setBusy(id)
    const res = await api<{ current: boolean; message: string }>(
      `/api/me/sessions/${id}`,
      undefined,
      'DELETE',
    )
    setBusy(null)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok && res.data.current) {
      router.push('/')
      router.refresh()
      return
    }
    if (res.ok) router.refresh()
  }
  const revokeOthers = async () => {
    setBusy('all')
    const res = await api<{ message: string }>('/api/me/sessions', undefined, 'DELETE')
    setBusy(null)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok) router.refresh()
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-line-soft rounded-md border border-line">
        {sessions.map((s) => {
          const mobile = s.os === 'iOS' || s.os === 'Android'
          const Icon = mobile ? Smartphone : Monitor
          return (
            <li key={s.id} className="flex items-center gap-3 p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-muted">
                <Icon size={16} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                  {s.browser} · {s.os}
                  {s.current ? (
                    <span className="rounded-sm bg-brand-wash px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-hover">
                      {messages.auth.thisDevice}
                    </span>
                  ) : null}
                </p>
                <p className="text-[12px] text-fg-muted">
                  {s.lastSeenAt ? (
                    <>
                      {fmt(messages.me.security.lastSeen, { time: '' })}
                      <RelativeTime iso={s.lastSeenAt} />
                    </>
                  ) : null}
                  {' · '}
                  {fmt(messages.me.security.signedIn, { time: '' })}
                  <RelativeTime iso={s.createdAt} />
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => revoke(s.id)}
                disabled={busy !== null}
              >
                {s.current ? messages.nav.signOut : messages.auth.revoke}
              </Button>
            </li>
          )
        })}
      </ul>
      {sessions.length > 1 ? (
        <div>
          <Button variant="outline" size="sm" onClick={revokeOthers} disabled={busy !== null}>
            {messages.auth.signOutEverywhere}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function ChangePasswordForm() {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const idA = useId()
  const idB = useId()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < 10) {
      setError(messages.auth.weakPassword)
      return
    }
    setBusy(true)
    setError(null)
    const res = await api<{ message: string }>('/api/me/password', {
      currentPassword: current,
      password: next,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setCurrent('')
    setNext('')
    toast.toast({ title: res.data.message })
  }
  return (
    <form onSubmit={submit} className="flex max-w-[420px] flex-col gap-3">
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={idA} className={labelClasses}>
          {messages.me.security.currentPassword}
        </label>
        <input
          id={idA}
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={inputClasses}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={idB} className={labelClasses}>
          {messages.me.security.newPassword}
        </label>
        <input
          id={idB}
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={inputClasses}
        />
        <p className="text-[12px] text-fg-subtle">{messages.authPage.passwordHint}</p>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={busy || !current || !next}>
          {messages.me.security.changePassword}
        </Button>
      </div>
    </form>
  )
}

export function TotpPanel({ enabled, hasPassword }: { enabled: boolean; hasPassword: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [enrol, setEnrol] = useState<{ secret: string; uri: string; qrDataUrl: string } | null>(
    null,
  )
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const codeId = useId()
  const pwId = useId()

  const start = async () => {
    setBusy(true)
    setError(null)
    const res = await api<{ secret: string; uri: string; qrDataUrl: string }>('/api/me/totp')
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setEnrol(res.data)
  }
  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await api<{ message: string }>('/api/me/totp', { code }, 'PATCH')
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setEnrol(null)
    setCode('')
    toast.toast({ title: res.data.message })
    router.refresh()
  }
  const disable = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await api<{ message: string }>('/api/me/totp', { password }, 'DELETE')
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    setPassword('')
    toast.toast({ title: res.data.message })
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-fg">
        {enabled ? (
          <ShieldCheck size={16} aria-hidden="true" className="text-ok" />
        ) : (
          <ShieldOff size={16} aria-hidden="true" className="text-fg-subtle" />
        )}
        {enabled ? messages.me.security.totpOn : messages.me.security.totpOff}
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      {enabled ? (
        <form onSubmit={disable} className="flex max-w-[420px] flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={pwId} className={labelClasses}>
              {messages.me.security.totpPasswordToDisable}
            </label>
            <input
              id={pwId}
              type="password"
              autoComplete="current-password"
              required={hasPassword}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy || (hasPassword && !password)}
            >
              {messages.me.security.totpDisable}
            </Button>
          </div>
        </form>
      ) : enrol ? (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <p className="text-[13px] text-fg-muted">{messages.me.security.totpScan}</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <img
              src={enrol.qrDataUrl}
              alt={enrol.uri}
              width={168}
              height={168}
              className="size-[168px] shrink-0 rounded-md bg-white p-2"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div>
                <p className="text-[12px] font-semibold text-fg-muted">
                  {messages.me.security.totpSecret}
                </p>
                <code className="mt-1 block break-all rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-fg">
                  {enrol.secret}
                </code>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={codeId} className={labelClasses}>
                  {messages.authPage.totpCode}
                </label>
                <input
                  id={codeId}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className={cn(inputClasses, 'max-w-[160px] tracking-[0.2em]')}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || code.length !== 6}>
                  {messages.me.security.totpConfirm}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEnrol(null)}>
                  {messages.common.cancel}
                </Button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <div>
          <Button size="sm" variant="outline" onClick={start} disabled={busy}>
            {messages.me.security.totpEnable}
          </Button>
        </div>
      )}
    </div>
  )
}
