import { fmt, messages } from '@palscans/core/messages'
import { Check, Lock } from 'lucide-react'
import { cn } from './cn'
import { RelativeTime } from './RelativeTime'

export interface ChapterRowProps {
  number: number | string
  title?: string
  href: string
  /** ISO 8601 publish time. */
  publishedAt: string
  /** The reader may not open this chapter yet. */
  locked?: boolean
  /** Shown next to the lock, e.g. "Free in 4h 12m". */
  lockLabel?: string
  /** Chapter is currently in the premium early-access window. */
  earlyAccess?: boolean
  read?: boolean
  /** Published within the last hour — gets the single 2s pulse. */
  isNew?: boolean
  className?: string
}

export function ChapterRow({
  number,
  title,
  href,
  publishedAt,
  locked = false,
  lockLabel,
  earlyAccess = false,
  read = false,
  isNew = false,
  className,
}: ChapterRowProps) {
  const label =
    typeof number === 'number' ? fmt(messages.reader.chapterSelect, { n: number }) : number
  return (
    <a
      href={href}
      aria-current={read ? undefined : undefined}
      className={cn(
        'flex h-14 items-center gap-3 rounded-md px-3 transition-colors duration-[120ms] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
        read ? 'text-fg-subtle' : 'text-fg',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-sm text-[11px] font-bold',
          read ? 'bg-surface-2 text-fg-subtle' : 'bg-brand-wash text-brand-hover',
        )}
        aria-hidden="true"
      >
        {read ? <Check size={16} strokeWidth={2.5} /> : '#'}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'font-display text-[15px] font-bold tabular-nums',
              isNew && 'motion-safe:animate-[pulse_2s_ease-in-out_1]',
            )}
          >
            {label}
          </span>
          {earlyAccess ? (
            <span className="rounded-sm bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-gold">
              {messages.series.earlyAccess}
            </span>
          ) : null}
        </span>
        {title ? <span className="truncate text-[13px] text-fg-muted">{title}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[12px] text-fg-muted">
        {locked ? (
          <span className="inline-flex items-center gap-1 text-fg-subtle">
            <Lock size={14} aria-label={messages.series.locked} />
            {lockLabel ? <span>{lockLabel}</span> : null}
          </span>
        ) : null}
        <RelativeTime iso={publishedAt} />
      </span>
    </a>
  )
}
