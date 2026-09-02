'use client'

import { messages } from '@palscans/core/messages'
import { X } from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn } from './cn'

export interface ToastOptions {
  title: string
  description?: string
  tone?: 'neutral' | 'ok' | 'danger'
  /** An undo (or similar) affordance. Destructive actions should always pass one. */
  action?: { label: string; onClick: () => void }
  /** Defaults to 10s when there is an action, 4s otherwise. */
  durationMs?: number
}

interface ToastRecord extends ToastOptions {
  id: number
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const counter = useRef(0)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t !== undefined) window.clearTimeout(t)
    timers.current.delete(id)
    setToasts((list) => list.filter((x) => x.id !== id))
  }, [])

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = ++counter.current
      const duration = options.durationMs ?? (options.action ? 10_000 : 4_000)
      setToasts((list) => [...list, { ...options, id }])
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), duration),
      )
      return id
    },
    [dismiss],
  )

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({
  toasts,
  dismiss,
}: {
  toasts: ToastRecord[]
  dismiss: (id: number) => void
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6"
    >
      {toasts.map((t) => (
        <output
          key={t.id}
          className={cn(
            'pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-md border bg-surface-2 px-3 py-2.5 text-sm text-fg shadow-2 motion-safe:animate-[toast-in_200ms_cubic-bezier(.2,0,0,1)]',
            t.tone === 'ok' && 'border-ok/40',
            t.tone === 'danger' && 'border-danger/40',
            (t.tone ?? 'neutral') === 'neutral' && 'border-line',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t.title}</span>
            {t.description ? (
              <span className="block text-[13px] text-fg-muted">{t.description}</span>
            ) : null}
          </span>
          {t.action ? (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick()
                dismiss(t.id)
              }}
              className="rounded-sm px-2 py-1 text-[13px] font-bold text-brand-hover hover:bg-brand-wash"
            >
              {t.action.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label={messages.nav.close}
            className="inline-flex size-8 items-center justify-center rounded-sm text-fg-subtle hover:bg-surface-3 hover:text-fg"
          >
            <X size={16} />
          </button>
        </output>
      ))}
    </div>
  )
}
