import type { ReactNode } from 'react'
import { cn } from './cn'

export interface EmptyStateProps {
  title: string
  description?: string
  /** An illustration or icon; sized by the caller. */
  icon?: ReactNode
  /** One clear action, usually a `Button`. */
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? <div className="text-fg-subtle">{icon}</div> : null}
      <p className="font-display text-lg font-bold text-fg">{title}</p>
      {description ? <p className="max-w-[40ch] text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
