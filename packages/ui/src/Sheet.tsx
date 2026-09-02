'use client'

import { messages } from '@palscans/core/messages'
import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { cn } from './cn'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
}

/**
 * One component: a bottom sheet below `md`, a centred dialog above it. Built on the native
 * `<dialog>` so focus trapping, Escape and the top layer are handled by the browser.
 */
export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // A click on the backdrop lands on the <dialog> itself; Escape is handled natively.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const onBackdropClick = (e: MouseEvent) => {
      if (e.target === dialog) onClose()
    }
    dialog.addEventListener('click', onBackdropClick)
    return () => dialog.removeEventListener('click', onBackdropClick)
  }, [onClose])

  return (
    <dialog
      ref={ref}
      aria-labelledby={title ? titleId : undefined}
      onClose={onClose}
      className={cn(
        'm-0 w-full max-w-none overscroll-contain bg-surface-2 p-0 text-fg shadow-2 backdrop:bg-bg/70 backdrop:backdrop-blur-sm',
        // mobile: bottom sheet
        'fixed inset-x-0 bottom-0 top-auto max-h-[90dvh] rounded-t-lg',
        // desktop: centred dialog
        'md:inset-0 md:m-auto md:h-fit md:max-h-[85dvh] md:w-[min(560px,calc(100vw-2rem))] md:rounded-lg',
        'open:motion-safe:animate-[sheet-in_320ms_cubic-bezier(.2,0,0,1)]',
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
        <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-line md:hidden" />
        {title ? (
          <h2 id={titleId} className="hidden font-display text-base font-bold md:block">
            {title}
          </h2>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={messages.nav.close}
          className="ml-auto hidden size-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg md:inline-flex"
        >
          <X size={18} />
        </button>
      </div>
      {title ? (
        <h2 className="px-4 pt-3 font-display text-base font-bold md:hidden">{title}</h2>
      ) : null}
      <div className="overflow-y-auto p-4">{children}</div>
    </dialog>
  )
}
