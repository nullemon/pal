'use client'

import { fmt, messages } from '@palscans/core/messages'
import { buttonClasses, cn } from '@palscans/ui'
import { useActionState, useCallback, useEffect, useId, useState } from 'react'
import { TurnstileWidget } from '@/components/comments/TurnstileWidget'
import { IDLE } from '@/lib/seo/form-state'
import { submitDmca } from './actions'

const m = messages.legal.dmca

const field =
  'w-full rounded-[10px] border border-line bg-surface-1 px-3 text-[15px] text-fg outline-none placeholder:text-fg-subtle focus:border-brand'

function Label({ htmlFor, children, hint }: { htmlFor: string; children: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-0.5 text-[13px] font-semibold text-fg">
      {children}
      {hint ? <span className="text-[12px] font-normal text-fg-muted">{hint}</span> : null}
    </label>
  )
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-[12.5px] text-danger">{message}</p> : null
}

/**
 * `turnstileSiteKey` comes from the server (admin panel first, environment second) and is
 * null when the operator has not configured bot protection — the widget is then simply not
 * rendered, and `verifyTurnstile` passes every request, so local development needs no
 * Cloudflare account.
 */
export function DmcaForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [state, action, pending] = useActionState(submitDmca, IDLE)
  const id = useId()
  const errors = state.status === 'error' ? (state.fields ?? {}) : {}
  const [token, setToken] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const clearToken = useCallback(() => setToken(''), [])

  // Tokens are single-use: a rejected submission must not resubmit the spent one.
  useEffect(() => {
    if (state.status === 'error') {
      setToken('')
      setResetKey((n) => n + 1)
    }
  }, [state])

  if (state.status === 'ok') {
    return (
      <div
        role="status"
        className="rounded-lg border border-ok/40 bg-ok/10 p-4 text-[14px] text-fg"
      >
        {fmt(m.sent, { id: state.id, email: state.email })}
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.status === 'error' && !state.fields ? <FieldError message={state.message} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-claimant`}>{m.claimant}</Label>
          <input id={`${id}-claimant`} name="claimant" required className={cn(field, 'h-11')} />
          <FieldError message={errors.claimant} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-email`}>{m.email}</Label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            className={cn(field, 'h-11')}
          />
          <FieldError message={errors.email} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-urls`} hint={m.urlsHint}>
          {m.urls}
        </Label>
        <textarea
          id={`${id}-urls`}
          name="urls"
          rows={4}
          required
          className={cn(field, 'py-2 font-mono text-[13px]')}
        />
        <FieldError message={errors.urls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-work`} hint={m.workHint}>
          {m.work}
        </Label>
        <textarea id={`${id}-work`} name="work" rows={4} required className={cn(field, 'py-2')} />
        <FieldError message={errors.work} />
      </div>
      <div className="flex flex-col gap-2 text-[13.5px] leading-5 text-fg-muted">
        <label className="flex items-start gap-2.5">
          <input type="checkbox" name="goodFaith" required className="mt-1 accent-brand" />
          <span>{m.statement}</span>
        </label>
        <FieldError message={errors.goodFaith} />
        <label className="flex items-start gap-2.5">
          <input type="checkbox" name="accuracy" required className="mt-1 accent-brand" />
          <span>{m.accuracy}</span>
        </label>
        <FieldError message={errors.accuracy} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-sig`}>{m.signature}</Label>
        <input id={`${id}-sig`} name="signature" required className={cn(field, 'h-11')} />
        <FieldError message={errors.signature} />
      </div>
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />
      {turnstileSiteKey ? (
        <div>
          <input type="hidden" name="turnstile" value={token} />
          <TurnstileWidget
            siteKey={turnstileSiteKey}
            onToken={setToken}
            onExpire={clearToken}
            resetKey={resetKey}
          />
        </div>
      ) : null}
      <div>
        <button type="submit" disabled={pending} className={buttonClasses('primary', 'lg')}>
          {pending ? m.sending : m.submit}
        </button>
      </div>
    </form>
  )
}
