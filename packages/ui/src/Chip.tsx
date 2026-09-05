import { messages } from '@palscans/core/messages'
import type { ReactNode } from 'react'
import { cn } from './cn'
import type { SeriesStatus, SeriesType } from './types'

export type ChipVariant = 'genre' | 'type' | 'status'

const typeClasses: Record<SeriesType, string> = {
  manhwa: 'bg-type-manhwa/10 text-type-manhwa-text',
  manhua: 'bg-type-manhua/10 text-type-manhua-text',
  manga: 'bg-type-manga/10 text-type-manga-text',
  comic: 'bg-type-comic/10 text-type-comic-text',
}

const statusClasses: Record<SeriesStatus, string> = {
  ongoing: 'bg-status-ongoing/10 text-status-ongoing-text',
  completed: 'bg-status-completed/10 text-status-completed-text',
  hiatus: 'bg-status-hiatus/10 text-status-hiatus-text',
  cancelled: 'bg-status-cancelled/10 text-status-cancelled-text',
}

export type ChipProps = {
  className?: string
  size?: 'sm' | 'md'
  href?: string
} & (
  | { variant: 'genre'; children: ReactNode }
  | { variant: 'type'; value: SeriesType; children?: ReactNode }
  | { variant: 'status'; value: SeriesStatus; children?: ReactNode }
)

export function Chip(props: ChipProps) {
  const { className, size = 'md', href } = props
  let colour: string
  let label: ReactNode
  if (props.variant === 'type') {
    colour = typeClasses[props.value]
    label = props.children ?? messages.series.type[props.value]
  } else if (props.variant === 'status') {
    colour = statusClasses[props.value]
    label = props.children ?? messages.series.status[props.value]
  } else {
    colour = 'bg-surface-2 text-fg-muted hover:bg-surface-3 hover:text-fg'
    label = props.children
  }
  const classes = cn(
    'inline-flex items-center rounded-sm font-bold uppercase tracking-[0.08em] leading-none whitespace-nowrap',
    size === 'sm' ? 'h-[18px] px-1.5 text-[10px]' : 'h-6 px-2 text-[11px]',
    colour,
    className,
  )
  if (href) {
    return (
      <a href={href} className={classes}>
        {label}
      </a>
    )
  }
  return <span className={classes}>{label}</span>
}
