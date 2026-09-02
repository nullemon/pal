import { messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import type { ReactNode } from 'react'

/**
 * Server-safe admin primitives matching design/mockups/admin: panels with a 14px radius on
 * surface-1, 13px labels, dense tables. Interactive controls live in ./client/controls.tsx.
 */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-body text-[22px] font-bold leading-7 tracking-[-0.01em] normal-case">
          {title}
        </h1>
        {subtitle ? <p className="text-[13.5px] leading-5 text-fg-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Panel({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'form'
}) {
  return (
    <Tag className={cn('rounded-lg border border-line bg-surface-1 p-4 md:px-5', className)}>
      {children}
    </Tag>
  )
}

export function PanelHeader({
  title,
  hint,
  aside,
}: {
  title: string
  hint?: string
  aside?: ReactNode
}) {
  return (
    <div className="mb-3.5 flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-body text-[16px] font-bold leading-[22px] normal-case tracking-normal">
          {title}
        </h2>
        {hint ? <p className="text-[13px] leading-[18px] text-fg-muted">{hint}</p> : null}
      </div>
      {aside ? (
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[12.5px] leading-[18px] text-fg-muted">
          {aside}
        </div>
      ) : null}
    </div>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-fg-muted">
      {children}
    </div>
  )
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[13px] leading-[17px] text-fg-muted', className)}>{children}</p>
}

export const inputClass =
  'h-9 w-full rounded-md border border-line bg-bg px-3 text-[13px] text-fg placeholder:text-fg-subtle focus-visible:border-brand focus-visible:outline-none disabled:opacity-50'
export const textareaClass =
  'w-full rounded-md border border-line bg-bg px-3 py-2 text-[13px] leading-5 text-fg placeholder:text-fg-subtle focus-visible:border-brand focus-visible:outline-none disabled:opacity-50'
export const selectClass = cn(inputClass, 'appearance-none pr-8')

export function Field({
  label,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-[12px] font-medium leading-4 text-fg-muted">
        {label}
      </label>
      {children}
      {hint ? <span className="text-[12px] leading-4 text-fg-subtle">{hint}</span> : null}
    </div>
  )
}

export type PillTone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'gold'

const pillTones: Record<PillTone, string> = {
  neutral: 'bg-surface-3 text-fg-muted',
  brand: 'bg-brand-wash text-brand-hover',
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
  gold: 'bg-gold/15 text-gold',
}

export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: PillTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center whitespace-nowrap rounded-full px-1.5 text-[10px] font-bold uppercase leading-none tracking-[0.08em]',
        pillTones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

const chapterStateTone: Record<string, PillTone> = {
  draft: 'neutral',
  processing: 'brand',
  ready: 'warn',
  scheduled: 'gold',
  published: 'ok',
  failed: 'danger',
  removed: 'neutral',
}

export function ChapterStatePill({ state }: { state: string }) {
  const label =
    messages.admin.chapters.states[state as keyof typeof messages.admin.chapters.states] ?? state
  return <Pill tone={chapterStateTone[state] ?? 'neutral'}>{label}</Pill>
}

const pubStateTone: Record<string, PillTone> = {
  draft: 'neutral',
  scheduled: 'gold',
  published: 'ok',
  unlisted: 'warn',
  removed: 'danger',
}

export function PubStatePill({ state }: { state: string }) {
  return <Pill tone={pubStateTone[state] ?? 'neutral'}>{state}</Pill>
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line bg-surface-2 px-1 font-body text-[11px] font-semibold text-fg-muted">
      {children}
    </kbd>
  )
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-line bg-surface-1', className)}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  )
}

export function Th({
  children,
  className,
  align = 'left',
}: {
  children?: ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <th
      className={cn(
        'h-9 border-b border-line px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  className,
  align = 'left',
}: {
  children?: ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <td
      className={cn(
        'h-11 border-b border-line-soft px-3 align-middle',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  )
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children?: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="h-24 text-center text-[13px] text-fg-muted">
        {children ?? messages.admin.noResults}
      </td>
    </tr>
  )
}

export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{children}</span>
}

/** `<time datetime>` rendered server-side; the client formats it relative (docs/16). */
export function When({ date, className }: { date: Date | null | undefined; className?: string }) {
  if (!date) return <span className={cn('text-fg-subtle', className)}>—</span>
  const iso = date.toISOString()
  return (
    <time dateTime={iso} title={iso} className={cn('tabular-nums', className)}>
      {iso.slice(0, 16).replace('T', ' ')}
    </time>
  )
}

export function StatTile({
  label,
  value,
  delta,
  tone,
  href,
  hint,
}: {
  label: string
  value: ReactNode
  delta?: ReactNode
  tone?: PillTone
  href?: string
  hint?: string
}) {
  const body = (
    <>
      <div className="text-[12px] font-medium leading-4 text-fg-muted">{label}</div>
      <div
        className={cn(
          'mt-1 font-body text-[26px] font-bold leading-8 tabular-nums tracking-[-0.01em]',
          tone === 'danger' && 'text-danger',
          tone === 'warn' && 'text-warn',
        )}
      >
        {value}
      </div>
      {delta ? <div className="mt-1 text-[12px] leading-4 text-fg-muted">{delta}</div> : null}
      {hint ? <div className="mt-1 text-[12px] leading-4 text-fg-subtle">{hint}</div> : null}
    </>
  )
  const cls = 'block rounded-lg border border-line bg-surface-1 p-4 hover:border-fg-subtle/60'
  return href ? (
    <a href={href} className={cls}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function Pagination({
  page,
  pages,
  hrefFor,
}: {
  page: number
  pages: number
  hrefFor: (page: number) => string
}) {
  if (pages <= 1) return null
  const m = messages.admin
  const link =
    'inline-flex h-8 items-center rounded-md border border-line px-3 text-[13px] hover:bg-surface-2'
  return (
    <nav className="flex items-center justify-between text-[13px] text-fg-muted">
      <span>{m.page.replace('{page}', String(page)).replace('{pages}', String(pages))}</span>
      <div className="flex gap-2">
        {page > 1 ? (
          <a className={link} href={hrefFor(page - 1)}>
            {m.previousPage}
          </a>
        ) : null}
        {page < pages ? (
          <a className={link} href={hrefFor(page + 1)}>
            {m.nextPage}
          </a>
        ) : null}
      </div>
    </nav>
  )
}
