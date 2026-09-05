/** biome-ignore-all lint/a11y/useSemanticElements: the segmented control is a button group carrying radio semantics */
'use client'

import { messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, cn } from '@palscans/ui'
import { Check } from 'lucide-react'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

/** Mounts children into the top bar's action slot (Save / Discard live there per the mockup). */
export function TopBarActions({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setTarget(document.getElementById('admin-topbar-actions'))
  }, [])
  return target ? createPortal(children, target) : null
}

/** The "Unsaved changes" dot + Discard + Save trio from the mockup top bar. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  saveLabel = adminMessages.admin.saveChanges,
  status,
  canSave = true,
}: {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard?: () => void
  saveLabel?: string
  status?: ReactNode
  /**
   * Hold Save back while the form is invalid, without also holding Discard back. Defaults to
   * true, so every screen that does not pass it behaves exactly as before. Appearance → Copy
   * needs the two apart: a field with a bad placeholder must not be saveable, but Discard is
   * the way *out* of that state and disabling it strands the operator.
   */
  canSave?: boolean
}) {
  return (
    <TopBarActions>
      {status ? <div className="mr-1.5 text-[13px] text-fg-muted">{status}</div> : null}
      {dirty ? (
        <div className="mr-1.5 flex items-center gap-2 text-[13px] text-fg-muted">
          <span className="size-[7px] rounded-full bg-gold" aria-hidden="true" />
          {adminMessages.admin.unsaved}
        </div>
      ) : null}
      {onDiscard ? (
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-[9px]"
          disabled={!dirty || saving}
          onClick={onDiscard}
        >
          {adminMessages.admin.discard}
        </Button>
      ) : null}
      <Button
        size="sm"
        className="h-9 rounded-[9px] px-4 font-bold"
        disabled={!dirty || saving || !canSave}
        onClick={onSave}
      >
        <Check size={14} aria-hidden="true" />
        {saving ? adminMessages.admin.saving : saveLabel}
      </Button>
    </TopBarActions>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  ariaLabel,
  size = 'md',
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  /** Accessible name when no visible label is rendered. */
  ariaLabel?: string
  size?: 'sm' | 'md'
  disabled?: boolean
}) {
  const w = size === 'md' ? 'h-6 w-11' : 'h-5 w-9'
  const knob = size === 'md' ? 'size-[18px] top-[3px]' : 'size-4 top-0.5'
  const shift =
    size === 'md' ? (checked ? 'left-[23px]' : 'left-[3px]') : checked ? 'left-[18px]' : 'left-0.5'
  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative shrink-0 rounded-full transition-colors disabled:opacity-50',
          w,
          checked ? 'bg-brand' : 'bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute rounded-full shadow-1 transition-[left]',
            knob,
            shift,
            checked ? 'bg-white' : 'bg-fg-muted',
          )}
        />
      </button>
      {label ? (
        <span className={cn('text-[13px] font-semibold', checked ? 'text-fg' : 'text-fg-muted')}>
          {checked ? adminMessages.admin.on : adminMessages.admin.off}
        </span>
      ) : null}
    </span>
  )
}

export interface SegmentOption<V extends string | number> {
  value: V
  label: ReactNode
  disabled?: boolean
}

/** Segmented control: 40px tall with the violet-wash selected state (Layouts mockup). */
export function Segmented<V extends string | number>({
  value,
  onChange,
  options,
  size = 'md',
  ariaLabel,
  className,
}: {
  value: V
  onChange: (v: V) => void
  options: readonly SegmentOption<V>[]
  size?: 'sm' | 'md'
  ariaLabel?: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex gap-0.5 self-start rounded-[10px] border border-line bg-bg p-[3px]',
        size === 'md' ? 'h-10' : 'h-9',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-[7px] whitespace-nowrap rounded-[7px] px-3 text-[13px] font-semibold tabular-nums transition-colors disabled:opacity-40',
              size === 'md' ? 'h-8 min-w-9' : 'h-7 min-w-8',
              active
                ? 'bg-brand-wash text-brand-hover shadow-[inset_0_0_0_1px_var(--color-brand)]'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Typed confirmation for destructive / role actions (docs/04 interaction rules). */
export function ConfirmTyped({
  open,
  title,
  body,
  expected,
  confirmLabel,
  onConfirm,
  onClose,
  tone = 'danger',
  hint = adminMessages.admin.confirmTypedHint,
}: {
  open: boolean
  title: string
  body?: ReactNode
  expected: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  onClose: () => void
  tone?: 'danger' | 'brand'
  /** Overrides "This cannot be undone." — a reversible action must not claim otherwise. */
  hint?: string
}) {
  const [typed, setTyped] = useState('')
  const id = useId()
  useEffect(() => {
    if (!open) setTyped('')
  }, [open])
  if (!open) return null
  const ok = typed.trim() === expected
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        className="w-full max-w-md rounded-lg border border-line bg-surface-1 p-5 shadow-2"
      >
        <h2 id={`${id}-t`} className="font-body text-[16px] font-bold normal-case tracking-normal">
          {title}
        </h2>
        {body ? <div className="mt-2 text-[13px] leading-5 text-fg-muted">{body}</div> : null}
        <label htmlFor={`${id}-i`} className="mt-4 block text-[12px] font-medium text-fg-muted">
          {adminMessages.admin.confirmTyped.replace('{value}', expected)}
        </label>
        <input
          id={`${id}-i`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-line bg-bg px-3 text-[13px] focus-visible:border-brand focus-visible:outline-none"
          autoComplete="off"
        />
        <p className="mt-1 text-[12px] text-fg-subtle">{hint}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {messages.common.cancel}
          </Button>
          <Button
            size="sm"
            disabled={!ok}
            className={tone === 'danger' ? 'bg-danger text-white hover:bg-danger/90' : undefined}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Small modal with arbitrary body (schedule pickers, reject reasons). */
export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
}) {
  const id = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="w-full max-w-lg rounded-lg border border-line bg-surface-1 p-5 shadow-2"
      >
        <h2 id={id} className="font-body text-[16px] font-bold normal-case tracking-normal">
          {title}
        </h2>
        <div className="mt-3 flex flex-col gap-3">{children}</div>
        {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  )
}

/** Warn on navigation with unsaved changes; also keeps a localStorage draft (docs/04). */
export function useDraft<T>(key: string, value: T, dirty: boolean) {
  useEffect(() => {
    try {
      if (dirty) window.localStorage.setItem(key, JSON.stringify(value))
      else window.localStorage.removeItem(key)
    } catch {
      // storage unavailable
    }
  }, [key, value, dirty])
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}
