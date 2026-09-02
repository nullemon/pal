'use client'

import { messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import { AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { type InputHTMLAttributes, type ReactNode, useId, useState } from 'react'

export const inputClasses =
  'h-11 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-brand disabled:opacity-60 aria-[invalid=true]:border-danger'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  hint?: string
  error?: string | null
  trailing?: ReactNode
}

export function Field({ label, hint, error, trailing, className, ...input }: FieldProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] font-semibold text-fg">
          {label}
        </label>
        {trailing}
      </div>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(inputClasses, className)}
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} className="text-[12px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function PasswordField(props: FieldProps) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Field {...props} type={shown ? 'text' : 'password'} className="pr-16" />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="absolute right-2 top-[30px] inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[12px] font-semibold text-fg-muted hover:text-fg"
        aria-pressed={shown}
      >
        {shown ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        {shown ? messages.authPage.hide : messages.authPage.show}
      </button>
    </div>
  )
}

export function Notice({ tone, children }: { tone: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-danger/40 bg-danger/10 text-fg'
      : tone === 'ok'
        ? 'border-ok/40 bg-ok/10 text-fg'
        : 'border-line bg-surface-1 text-fg-muted'
  const Icon = tone === 'ok' ? CheckCircle2 : AlertCircle
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2 rounded-md border px-3 py-2.5 text-[13px]', styles)}
    >
      <Icon
        size={16}
        aria-hidden="true"
        className={cn(
          'mt-0.5 shrink-0',
          tone === 'error' ? 'text-danger' : tone === 'ok' ? 'text-ok' : 'text-fg-subtle',
        )}
      />
      <div>{children}</div>
    </div>
  )
}

export interface ApiOk<T> {
  ok: true
  data: T
}
export interface ApiErr {
  ok: false
  error: string
  message: string
  status: number
}

/** POST/PATCH/DELETE JSON to an API route and normalise `{ data } | { error }`. */
export async function api<T>(
  url: string,
  body?: unknown,
  method = 'POST',
): Promise<ApiOk<T> | ApiErr> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
    const json = (await res.json().catch(() => ({}))) as {
      data?: T
      error?: string
      message?: string
    }
    if (!res.ok || json.error) {
      return {
        ok: false,
        status: res.status,
        error: json.error ?? 'error',
        message: json.message ?? messages.errors.generic,
      }
    }
    return { ok: true, data: json.data as T }
  } catch {
    return { ok: false, status: 0, error: 'network', message: messages.errors.network }
  }
}
