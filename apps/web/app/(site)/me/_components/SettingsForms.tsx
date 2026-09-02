'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Avatar, Button, cn, useToast } from '@palscans/ui'
import { Download, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useRef, useState } from 'react'
import { api, inputClasses, labelClasses } from './api'

export function ProfileForm({
  initial,
}: {
  initial: { displayName: string; bio: string; safeMode: boolean }
}) {
  const router = useRouter()
  const toast = useToast()
  const [displayName, setDisplayName] = useState(initial.displayName)
  const [bio, setBio] = useState(initial.bio)
  const [safeMode, setSafeMode] = useState(initial.safeMode)
  const [busy, setBusy] = useState(false)
  const nameId = useId()
  const bioId = useId()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const res = await api<{ saved: boolean }>(
      '/api/me/profile',
      { displayName, bio, safeMode },
      'PATCH',
    )
    setBusy(false)
    toast.toast({ title: res.ok ? messages.account.saved : res.message })
    if (res.ok) router.refresh()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className={labelClasses}>
          {messages.me.settings.displayName}
        </label>
        <input
          id={nameId}
          value={displayName}
          maxLength={40}
          onChange={(e) => setDisplayName(e.target.value)}
          className={inputClasses}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={bioId} className={labelClasses}>
          {messages.me.settings.bio}
        </label>
        <textarea
          id={bioId}
          value={bio}
          maxLength={300}
          rows={3}
          onChange={(e) => setBio(e.target.value)}
          className={cn(inputClasses, 'h-auto py-2')}
        />
        <p className="text-[12px] text-fg-subtle">{messages.me.settings.bioHint}</p>
      </div>
      <label className="flex items-start gap-3 rounded-md border border-line bg-surface-2 p-3">
        <input
          type="checkbox"
          checked={safeMode}
          onChange={(e) => setSafeMode(e.target.checked)}
          className="mt-0.5 size-4 accent-brand"
        />
        <span>
          <span className="block text-sm font-semibold text-fg">{messages.account.safeMode}</span>
          <span className="block text-[12px] text-fg-muted">{messages.account.safeModeHint}</span>
        </span>
      </label>
      <div>
        <Button type="submit" size="sm" disabled={busy}>
          {messages.account.save}
        </Button>
      </div>
    </form>
  )
}

export function AvatarForm({ name, src }: { name: string; src: string | null }) {
  const router = useRouter()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(src)
  const [busy, setBusy] = useState(false)

  const upload = async (file: File) => {
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      toast.toast({ title: messages.me.settings.avatarHint })
      return
    }
    setBusy(true)
    const presign = await api<{
      key: string
      url: string
      method: string
      headers: Record<string, string>
    }>('/api/me/avatar', {
      contentType: file.type,
      size: file.size,
    })
    if (!presign.ok) {
      setBusy(false)
      toast.toast({ title: presign.message })
      return
    }
    const put = await fetch(presign.data.url, {
      method: presign.data.method,
      headers: presign.data.headers,
      body: file,
      credentials: 'same-origin',
    }).catch(() => null)
    if (!put?.ok) {
      setBusy(false)
      toast.toast({ title: messages.errors.generic })
      return
    }
    // The local upload route re-encodes and answers with the content-addressed key it stored.
    const stored = (await put
      .json()
      .then((j: { data?: { key?: string } }) => j.data?.key)
      .catch(() => undefined)) as string | undefined
    const confirm = await api<{ url: string | null; message: string }>('/api/me/avatar/confirm', {
      key: stored ?? presign.data.key,
    })
    setBusy(false)
    if (!confirm.ok) {
      toast.toast({ title: confirm.message })
      return
    }
    setPreview(confirm.data.url)
    toast.toast({ title: confirm.data.message })
    router.refresh()
  }

  const remove = async () => {
    setBusy(true)
    const res = await api<{ removed: boolean }>('/api/me/avatar', undefined, 'DELETE')
    setBusy(false)
    if (res.ok) {
      setPreview(null)
      router.refresh()
    } else toast.toast({ title: res.message })
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name} src={preview} size={64} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            <Upload size={14} aria-hidden="true" />
            {messages.me.settings.avatarUpload}
          </Button>
          {preview ? (
            <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>
              {messages.me.settings.avatarRemove}
            </Button>
          ) : null}
        </div>
        <p className="text-[12px] text-fg-subtle">{messages.me.settings.avatarHint}</p>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) upload(f)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

export function UsernameForm({
  current,
  nextChangeAt,
}: {
  current: string
  nextChangeAt: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [username, setUsername] = useState(current)
  const [busy, setBusy] = useState(false)
  const id = useId()
  const locked = !!nextChangeAt
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const res = await api<{ message: string }>('/api/me/username', { username })
    setBusy(false)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok) router.refresh()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className={labelClasses}>
          {messages.me.settings.username}
        </label>
        <div className="flex gap-2">
          <input
            id={id}
            value={username}
            minLength={3}
            maxLength={24}
            disabled={locked}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClasses}
          />
          <Button
            type="submit"
            size="md"
            variant="outline"
            disabled={busy || locked || username === current}
          >
            {messages.me.settings.usernameChange}
          </Button>
        </div>
      </div>
      <p className="text-[12px] text-fg-subtle">
        {messages.me.settings.usernameRule}
        {nextChangeAt ? (
          <>
            {' '}
            {fmt(messages.me.settings.usernameNext, { time: '' })}
            <time dateTime={nextChangeAt}>{nextChangeAt.slice(0, 10)}</time>
          </>
        ) : null}
      </p>
    </form>
  )
}

type Theme = 'dark' | 'light' | 'system'

export function ThemePicker({ initial }: { initial: Theme }) {
  const toast = useToast()
  const [theme, setTheme] = useState<Theme>(initial)
  const options: Array<{ value: Theme; label: string }> = [
    { value: 'dark', label: messages.account.themeDark },
    { value: 'light', label: messages.account.themeLight },
    { value: 'system', label: messages.account.themeSystem },
  ]
  const pick = async (next: Theme) => {
    setTheme(next)
    const resolved =
      next === 'system'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : next
    document.documentElement.dataset.theme = resolved
    const res = await api<{ theme: Theme }>('/api/me/theme', { theme: next })
    if (!res.ok) toast.toast({ title: res.message })
  }
  return (
    <div className="flex flex-col gap-2">
      <fieldset className="inline-flex rounded-lg border border-line bg-surface-2 p-1">
        <legend className="sr-only">{messages.account.theme}</legend>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-[13px] font-semibold transition-colors',
              theme === o.value ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            <input
              type="radio"
              name="theme"
              value={o.value}
              checked={theme === o.value}
              onChange={() => pick(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      <p className="text-[12px] text-fg-subtle">{messages.me.settings.themeHint}</p>
    </div>
  )
}

export function ResendVerificationButton() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const resend = async () => {
    setBusy(true)
    const res = await api<{ message?: string }>('/api/auth/resend-verification')
    setBusy(false)
    toast.toast({
      title: res.ok ? (res.data.message ?? messages.authPage.verifyResent) : res.message,
    })
  }
  return (
    <Button variant="outline" size="sm" onClick={resend} disabled={busy}>
      {messages.me.settings.resendVerification}
    </Button>
  )
}

export function ExportButton() {
  return (
    <Button href="/api/me/export" variant="outline" size="sm" download="palscans-export.json">
      <Download size={14} aria-hidden="true" />
      {messages.me.settings.exportCta}
    </Button>
  )
}

export function DeleteAccountForm({
  hasPassword,
  scheduledFor,
}: {
  hasPassword: boolean
  scheduledFor: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const id = useId()

  const schedule = async (e: FormEvent) => {
    e.preventDefault()
    if (!window.confirm(`${messages.me.settings.deleteTitle}?`)) return
    setBusy(true)
    const res = await api<{ message: string }>('/api/me/delete', {
      password: hasPassword ? password : undefined,
    })
    setBusy(false)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok) router.refresh()
  }
  const cancel = async () => {
    setBusy(true)
    const res = await api<{ message: string }>('/api/me/delete', undefined, 'DELETE')
    setBusy(false)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok) router.refresh()
  }

  if (scheduledFor) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/40 bg-warn/10 p-3">
        <p className="text-[13px] text-fg">
          {fmt(messages.me.settings.deleteScheduled, { date: '' })}
          <time dateTime={scheduledFor} className="font-semibold">
            {scheduledFor.slice(0, 10)}
          </time>
        </p>
        <div>
          <Button size="sm" onClick={cancel} disabled={busy}>
            {messages.me.settings.deleteCancel}
          </Button>
        </div>
      </div>
    )
  }
  return (
    <form onSubmit={schedule} className="flex flex-col gap-3">
      {hasPassword ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className={labelClasses}>
            {messages.me.settings.deleteConfirm}
          </label>
          <input
            id={id}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cn(inputClasses, 'max-w-[320px]')}
          />
        </div>
      ) : null}
      <div>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={busy || (hasPassword && !password)}
          className="border-danger/50 text-danger hover:bg-danger/10"
        >
          {messages.me.settings.deleteCta}
        </Button>
      </div>
    </form>
  )
}
