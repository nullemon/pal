'use client'

import { fmt, messages } from '@palscans/core/messages'
import { buttonClasses, cn } from '@palscans/ui'
import { useActionState, useCallback, useEffect, useId, useState } from 'react'
import { TurnstileWidget } from '@/components/comments/TurnstileWidget'
import { IDLE } from '@/lib/seo/form-state'
import { submitContact } from './actions'

const m = messages.legal.contact
const TOPICS = Object.keys(m.topics) as (keyof typeof m.topics)[]

const field =
  'w-full rounded-[10px] border border-line bg-surface-1 px-3 text-[15px] text-fg outline-none placeholder:text-fg-subtle focus:border-brand'

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-[12.5px] text-danger">{message}</p> : null
}

/**
 * `turnstileSiteKey` comes from the server (admin panel first, environment second), exactly
 * as `/dmca` does it, and is null when the operator has not configured bot protection — the
 * widget is then not rendered and `verifyTurnstile` passes every request, so local
 * development needs no Cloudflare account.
 */
export function ContactForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [state, action, pending] = useActionState(submitContact, IDLE)
  const id = useId()
  const errors = state.status === 'error' ? (state.fields ?? {}) : {}
  const label = 'text-[13px] font-semibold text-fg'
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
        {fmt(m.sent, { id: state.id })}
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.status === 'error' && !state.fields ? <FieldError message={state.message} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className={label}>
            {m.name}
          </label>
          <input id={`${id}-name`} name="name" required className={cn(field, 'h-11')} />
          <FieldError message={errors.name} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-email`} className={label}>
            {m.email}
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            className={cn(field, 'h-11')}
          />
          <FieldError message={errors.email} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-topic`} className={label}>
            {m.topic}
          </label>
          <select
            id={`${id}-topic`}
            name="topic"
            className={cn(field, 'h-11')}
            defaultValue="general"
          >
            {TOPICS.map((t) => (
              <option key={t} value={t}>
                {m.topics[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-subject`} className={label}>
            {m.subject}
          </label>
          <input id={`${id}-subject`} name="subject" required className={cn(field, 'h-11')} />
          <FieldError message={errors.subject} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-message`} className={label}>
          {m.message}
        </label>
        <textarea
          id={`${id}-message`}
          name="message"
          rows={6}
          required
          className={cn(field, 'py-2')}
        />
        <FieldError message={errors.message} />
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
